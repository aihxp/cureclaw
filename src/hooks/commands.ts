import type { CommandResult } from "../scheduler/commands.js";
import { addHook, listHooks, removeHook, isValidHookEvent, HOOK_EVENTS, type HookEventName } from "./config.js";

/**
 * Handle /hooks commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleHooksCommand(input: string, workspace: string): CommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/hooks")) return null;

  const rest = trimmed.slice(6).trim();

  if (rest === "" || rest === "help") {
    return {
      text: [
        "Hooks commands:",
        "  /hooks list                              List configured hooks",
        "  /hooks add <event> <command> [args...]    Add a hook",
        "  /hooks remove <event> <command>           Remove a hook",
        "",
        "Events: " + HOOK_EVENTS.join(", "),
      ].join("\n"),
    };
  }

  if (rest === "list") {
    return handleList(workspace);
  }

  if (rest === "add" || rest.startsWith("add ")) {
    return handleAdd(rest.slice(4).trim(), workspace);
  }

  if (rest === "remove" || rest.startsWith("remove ")) {
    return handleRemove(rest.slice(7).trim(), workspace);
  }

  return { text: "Unknown hooks subcommand. Type /hooks help for usage." };
}

function handleList(workspace: string): CommandResult {
  const hooks = listHooks(workspace);
  if (hooks.length === 0) {
    return { text: "No hooks configured. Use /hooks add to add one." };
  }

  const lines = ["Configured hooks:\n"];
  for (const h of hooks) {
    lines.push(`  ${h.event}:`);
    for (const e of h.entries) {
      const argsStr = e.args?.length ? " " + e.args.join(" ") : "";
      lines.push(`    ${e.command}${argsStr}`);
    }
  }
  return { text: lines.join("\n") };
}

function handleAdd(args: string, workspace: string): CommandResult {
  const parts = args.split(/\s+/);
  if (parts.length < 2) {
    return { text: "Usage: /hooks add <event> <command> [args...]" };
  }

  const [eventName, command, ...cmdArgs] = parts;

  if (!isValidHookEvent(eventName)) {
    return {
      text: `Invalid hook event: "${eventName}"\nValid events: ${HOOK_EVENTS.join(", ")}`,
    };
  }

  addHook(workspace, eventName as HookEventName, {
    command,
    args: cmdArgs.length > 0 ? cmdArgs : undefined,
  });

  return { text: `Hook added: ${eventName} → ${command}` };
}

function handleRemove(args: string, workspace: string): CommandResult {
  const parts = args.split(/\s+/);
  if (parts.length < 2) {
    return { text: "Usage: /hooks remove <event> <command>" };
  }

  const [eventName, command] = parts;

  if (!isValidHookEvent(eventName)) {
    return { text: `Invalid hook event: "${eventName}"` };
  }

  const removed = removeHook(workspace, eventName as HookEventName, command);
  if (removed) {
    return { text: `Hook removed: ${eventName} → ${command}` };
  }
  return { text: `Hook not found: ${eventName} → ${command}` };
}
