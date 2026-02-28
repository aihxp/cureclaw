import fs from "node:fs";
import path from "node:path";

export interface HookEntry {
  command: string;
  args?: string[];
}

export interface HooksConfig {
  version: 1;
  hooks: Record<string, HookEntry[]>;
}

export const HOOK_EVENTS = [
  "sessionStart", "stop", "beforeSubmitPrompt",
  "preToolUse", "postToolUse", "postToolUseFailure",
  "subagentStart", "subagentStop",
  "beforeShellExecution", "afterShellExecution",
  "beforeMCPExecution", "afterMCPExecution",
  "beforeReadFile", "afterFileEdit",
  "preCompact", "afterCompact", "beforeReset",
] as const;

export type HookEventName = typeof HOOK_EVENTS[number];

export function isValidHookEvent(s: string): s is HookEventName {
  return (HOOK_EVENTS as readonly string[]).includes(s);
}

function hooksJsonPath(workspace: string): string {
  return path.join(workspace, ".cursor", "hooks.json");
}

export function readHooksConfig(workspace: string): HooksConfig {
  const filePath = hooksJsonPath(workspace);
  if (!fs.existsSync(filePath)) {
    return { version: 1, hooks: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HooksConfig>;
    return { version: 1, hooks: parsed.hooks ?? {} };
  } catch {
    return { version: 1, hooks: {} };
  }
}

export function writeHooksConfig(workspace: string, config: HooksConfig): void {
  const filePath = hooksJsonPath(workspace);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function addHook(workspace: string, event: HookEventName, entry: HookEntry): void {
  const config = readHooksConfig(workspace);
  if (!config.hooks[event]) {
    config.hooks[event] = [];
  }
  config.hooks[event].push(entry);
  writeHooksConfig(workspace, config);
}

export function removeHook(workspace: string, event: HookEventName, command: string): boolean {
  const config = readHooksConfig(workspace);
  const entries = config.hooks[event];
  if (!entries) return false;

  const idx = entries.findIndex((e) => e.command === command);
  if (idx === -1) return false;

  entries.splice(idx, 1);
  if (entries.length === 0) {
    delete config.hooks[event];
  }
  writeHooksConfig(workspace, config);
  return true;
}

export function listHooks(workspace: string): Array<{ event: string; entries: HookEntry[] }> {
  const { hooks } = readHooksConfig(workspace);
  return Object.entries(hooks).map(([event, entries]) => ({ event, entries }));
}
