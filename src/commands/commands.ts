import type { CommandResult } from "../scheduler/commands.js";
import { discoverCommands } from "./list.js";

export interface CommandsResult extends CommandResult {
  /** If set, caller should feed this as a prompt to the agent */
  runPrompt?: string;
}

/**
 * Handle /commands and /run commands.
 * Returns CommandsResult if matched, null otherwise.
 */
export function handleCommandsCommand(input: string, workspace: string): CommandsResult | null {
  const trimmed = input.trim();

  if (trimmed === "/commands") {
    return listCommands(workspace);
  }

  if (trimmed.startsWith("/run ")) {
    return runCommand(trimmed.slice(5).trim(), workspace);
  }

  if (trimmed === "/run") {
    return { text: "Usage: /run <command-name> [additional context]" };
  }

  return null;
}

function listCommands(workspace: string): CommandsResult {
  const commands = discoverCommands(workspace);
  if (commands.length === 0) {
    return { text: "No custom commands found. Add .md files to .cursor/commands/ to create commands." };
  }

  const lines = ["Custom commands:\n"];
  for (const c of commands) {
    lines.push(`  ${c.name}  [${c.source}]  ${c.description || "(no description)"}`);
  }
  lines.push("");
  lines.push("Run a command: /run <name> [additional context]");
  return { text: lines.join("\n") };
}

function runCommand(args: string, workspace: string): CommandsResult {
  const parts = args.split(/\s+/);
  const name = parts[0];
  const extraContext = parts.slice(1).join(" ");

  if (!name) {
    return { text: "Usage: /run <command-name> [additional context]" };
  }

  const commands = discoverCommands(workspace);
  const command = commands.find((c) => c.name === name);

  if (!command) {
    return { text: `Command "${name}" not found. Use /commands to list available commands.` };
  }

  const prompt = extraContext
    ? `${command.template}\n\nContext: ${extraContext}`
    : command.template;

  return { text: `Running command "${name}"...`, runPrompt: prompt };
}
