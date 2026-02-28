import path from "node:path";
import type { CommandResult } from "../scheduler/commands.js";
import { buildPlugin } from "./build.js";
import { generateManifest } from "./manifest.js";

/**
 * Handle /plugin commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handlePluginCommand(input: string, workspace: string): CommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/plugin")) return null;

  const rest = trimmed.slice(7).trim();

  if (rest === "" || rest === "help") {
    return {
      text: [
        "Plugin commands:",
        "  /plugin build [--name <name>] [--version <version>]",
        "  /plugin info   Show what would be included (dry run)",
      ].join("\n"),
    };
  }

  if (rest === "info") {
    return handleInfo(workspace);
  }

  if (rest.startsWith("build")) {
    return handleBuild(rest.slice(5).trim(), workspace);
  }

  return { text: "Unknown plugin subcommand. Type /plugin help for usage." };
}

function handleInfo(workspace: string): CommandResult {
  const manifest = generateManifest({ name: "plugin", workspace });

  const lines = ["Plugin contents:\n"];

  if (manifest.rules) lines.push(`  Rules: ${manifest.rules}`);
  if (manifest.skills) lines.push(`  Skills: ${manifest.skills}`);
  if (manifest.agents) lines.push(`  Agents: ${manifest.agents}`);
  if (manifest.mcpServers) lines.push(`  MCP servers: ${manifest.mcpServers}`);

  if (lines.length === 1) {
    return { text: "No plugin artifacts found in workspace." };
  }

  return { text: lines.join("\n") };
}

function handleBuild(args: string, workspace: string): CommandResult {
  let name = path.basename(workspace) || "plugin";
  let version: string | undefined;

  const nameMatch = args.match(/--name\s+(\S+)/);
  if (nameMatch) name = nameMatch[1];

  const versionMatch = args.match(/--version\s+(\S+)/);
  if (versionMatch) version = versionMatch[1];

  const outputDir = path.join(workspace, ".cursor-plugin-build");

  try {
    const result = buildPlugin({ workspace, outputDir, name, version });
    const lines = [
      `Plugin built: ${result.outputDir}`,
      `Name: ${result.manifest.name}`,
    ];
    if (result.manifest.version) lines.push(`Version: ${result.manifest.version}`);
    lines.push(`Files: ${result.copiedFiles.length}`);
    return { text: lines.join("\n") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error: ${msg}` };
  }
}
