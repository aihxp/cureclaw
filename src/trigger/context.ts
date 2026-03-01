import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ContextProvider } from "../types.js";

const MAX_OUTPUT_LENGTH = 8000;
const VALID_KINDS = ["git_diff", "git_log", "shell", "file", "memory"] as const;

export function isValidContextKind(kind: string): kind is ContextProvider["kind"] {
  return (VALID_KINDS as readonly string[]).includes(kind);
}

/**
 * Parse a context provider spec like "git_diff", "git_log:20", "shell:npm test", "file:README.md".
 */
export function parseContextProvider(spec: string): ContextProvider {
  const colonIdx = spec.indexOf(":");
  const kind = colonIdx === -1 ? spec : spec.slice(0, colonIdx);
  const arg = colonIdx === -1 ? undefined : spec.slice(colonIdx + 1);

  if (!isValidContextKind(kind)) {
    throw new Error(`Invalid context kind: ${kind}. Valid: ${VALID_KINDS.join(", ")}`);
  }

  // Auto-generate name from kind
  let name: string;
  switch (kind) {
    case "git_diff":
      name = "diff";
      break;
    case "git_log":
      name = "log";
      break;
    case "file":
      name = arg ? path.basename(arg, path.extname(arg)) : "file";
      break;
    case "memory":
      name = arg ? `memory_${arg.replace(/\s+/g, "_")}` : "memories";
      break;
    default:
      name = kind;
  }

  return { name, kind, arg };
}

/**
 * Execute all context providers and return a name→value map.
 * Errors in individual providers are captured as error strings, not thrown.
 */
export async function gatherContext(
  providers: ContextProvider[],
  cwd: string,
): Promise<Map<string, string>> {
  const context = new Map<string, string>();

  for (const provider of providers) {
    try {
      let output: string;
      switch (provider.kind) {
        case "git_diff":
          output = execSync("git diff", { cwd, timeout: 10_000, encoding: "utf-8" });
          break;
        case "git_log": {
          const count = provider.arg || "10";
          output = execSync(`git log --oneline -${count}`, { cwd, timeout: 10_000, encoding: "utf-8" });
          break;
        }
        case "shell":
          if (!provider.arg) {
            output = "(no command specified)";
            break;
          }
          output = execSync(provider.arg, { cwd, timeout: 30_000, encoding: "utf-8" });
          break;
        case "file": {
          if (!provider.arg) {
            output = "(no file specified)";
            break;
          }
          const filePath = path.resolve(cwd, provider.arg);
          output = fs.readFileSync(filePath, "utf-8");
          break;
        }
        case "memory": {
          const { buildMemoryContext } = await import("../memory/memory.js");
          output = buildMemoryContext(provider.arg || "");
          break;
        }
      }
      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH) + "\n...(truncated)";
      }
      context.set(provider.name, output.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      context.set(provider.name, `(error: ${msg})`);
    }
  }

  return context;
}

/**
 * Replace {{context.NAME}} placeholders in a prompt template.
 * Unresolved placeholders are left as-is.
 */
export function interpolateContext(
  template: string,
  context: Map<string, string>,
): string {
  return template.replace(/\{\{context\.([^}]+)\}\}/g, (match, name: string) => {
    return context.has(name) ? context.get(name)! : match;
  });
}

/**
 * Replace {{event.*}} placeholders: {{event.status}}, {{event.result}}, {{event.payload}}.
 * Unresolved placeholders are left as-is.
 */
export function interpolateEvent(
  template: string,
  event: Record<string, string>,
): string {
  return template.replace(/\{\{event\.([^}]+)\}\}/g, (match, key: string) => {
    return key in event ? event[key] : match;
  });
}
