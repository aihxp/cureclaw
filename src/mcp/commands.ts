import type { CommandResult } from "../scheduler/commands.js";
import { addMcpServer, listMcpServers, removeMcpServer } from "./config.js";
import { findPreset, listPresets, checkPresetEnv, formatPresetList } from "./presets.js";

/**
 * Handle /mcp commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleMcpCommand(input: string, workspace: string): CommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/mcp")) return null;

  const rest = trimmed.slice(4).trim();

  if (rest === "" || rest === "help") {
    return {
      text: [
        "MCP commands:",
        "  /mcp list                          List configured MCP servers",
        "  /mcp add <name> <command> [args]   Add an MCP server",
        "  /mcp remove <name>                 Remove an MCP server",
        "  /mcp presets [category]            List curated MCP server presets",
        "  /mcp install <name>                Install a preset MCP server",
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

  if (rest === "presets" || rest.startsWith("presets ")) {
    const category = rest.slice(7).trim() || undefined;
    const presets = listPresets(category);
    return { text: formatPresetList(presets) };
  }

  if (rest === "install" || rest.startsWith("install ")) {
    return handleInstall(rest.slice(8).trim(), workspace);
  }

  return { text: "Unknown MCP subcommand. Type /mcp help for usage." };
}

function handleList(workspace: string): CommandResult {
  const servers = listMcpServers(workspace);
  if (servers.length === 0) {
    return { text: "No MCP servers configured. Use /mcp add to add one." };
  }

  const lines = ["MCP servers:\n"];
  for (const s of servers) {
    const argsStr = s.config.args?.length ? " " + s.config.args.join(" ") : "";
    lines.push(`  ${s.name}: ${s.config.command}${argsStr}`);
  }
  return { text: lines.join("\n") };
}

function handleAdd(args: string, workspace: string): CommandResult {
  // Parse: <name> <command> [args...]
  const parts = args.split(/\s+/);
  if (parts.length < 2) {
    return { text: "Usage: /mcp add <name> <command> [args...]" };
  }

  const [name, command, ...cmdArgs] = parts;

  try {
    addMcpServer(workspace, name, {
      command,
      args: cmdArgs.length > 0 ? cmdArgs : undefined,
    });
    return { text: `MCP server "${name}" added.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error: ${msg}` };
  }
}

function handleInstall(presetName: string, workspace: string): CommandResult {
  if (!presetName) {
    return { text: "Usage: /mcp install <name>. Use /mcp presets to see available." };
  }

  const preset = findPreset(presetName);
  if (!preset) {
    return { text: `Unknown preset "${presetName}". Use /mcp presets to see available.` };
  }

  const envCheck = checkPresetEnv(preset);
  if (!envCheck.ready) {
    return { text: `Missing env vars: ${envCheck.missing.join(", ")}. Set them before installing.` };
  }

  try {
    addMcpServer(workspace, preset.name, { command: preset.command, args: preset.args });
    return { text: `Installed MCP server "${preset.name}": ${preset.description}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error: ${msg}` };
  }
}

function handleRemove(name: string, workspace: string): CommandResult {
  if (!name) {
    return { text: "Usage: /mcp remove <name>" };
  }

  const removed = removeMcpServer(workspace, name);
  if (removed) {
    return { text: `MCP server "${name}" removed.` };
  }
  return { text: `MCP server "${name}" not found.` };
}
