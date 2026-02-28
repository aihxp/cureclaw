import path from "node:path";
import type { CommandResult } from "../scheduler/commands.js";
import { scaffoldAgent, validateAgentName } from "./scaffold.js";
import { discoverAgents } from "./list.js";

/**
 * Handle /agents and /agent commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleAgentCommand(input: string, workspace: string): CommandResult | null {
  const trimmed = input.trim();

  if (trimmed === "/agents") {
    return listAgents(workspace);
  }

  if (trimmed.startsWith("/agent ")) {
    const rest = trimmed.slice(7).trim();
    if (rest.startsWith("create ")) {
      return createAgent(rest.slice(7).trim(), workspace);
    }
    return { text: 'Usage: /agent create <name> [--model <m>] [--readonly] [--description "..."]' };
  }

  if (trimmed === "/agent") {
    return { text: 'Usage: /agent create <name> [--model <m>] [--readonly] [--description "..."]\n       /agents — list discovered subagents' };
  }

  return null;
}

function listAgents(workspace: string): CommandResult {
  const agents = discoverAgents(workspace);
  if (agents.length === 0) {
    return { text: "No subagents found. Use /agent create <name> to create one." };
  }

  const lines = ["Discovered subagents:\n"];
  for (const a of agents) {
    const flags = [
      a.readonly ? "readonly" : null,
      a.isBackground ? "background" : null,
      a.model && a.model !== "inherit" ? `model:${a.model}` : null,
    ].filter(Boolean).join(", ");
    const flagStr = flags ? `  (${flags})` : "";
    lines.push(`  ${a.slug}  [${a.source}]  ${a.description || "(no description)"}${flagStr}`);
    lines.push(`    ${a.path}`);
  }
  return { text: lines.join("\n") };
}

function createAgent(args: string, workspace: string): CommandResult {
  // Parse: <name> [--model <m>] [--readonly] [--description "..."]
  let name: string;
  let description: string | undefined;
  let model: string | undefined;
  let readonly = false;

  // Extract --description "..."
  const descMatch = args.match(/--description\s+"((?:[^"\\]|\\.)*)"/);
  if (descMatch) {
    description = descMatch[1].replace(/\\"/g, '"');
    args = args.replace(descMatch[0], "").trim();
  }

  // Extract --model <m>
  const modelMatch = args.match(/--model\s+(\S+)/);
  if (modelMatch) {
    model = modelMatch[1];
    args = args.replace(modelMatch[0], "").trim();
  }

  // Extract --readonly
  if (args.includes("--readonly")) {
    readonly = true;
    args = args.replace(/--readonly/, "").trim();
  }

  name = args.split(/\s+/)[0];

  if (!name) {
    return { text: 'Usage: /agent create <name> [--model <m>] [--readonly] [--description "..."]' };
  }

  const nameErr = validateAgentName(name);
  if (nameErr) {
    return { text: `Invalid agent name: ${nameErr}` };
  }

  const baseDir = path.join(workspace, ".cursor", "agents");

  try {
    const filePath = scaffoldAgent({ name, description, model, readonly, baseDir });
    return { text: `Subagent "${name}" created at ${filePath}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error: ${msg}` };
  }
}
