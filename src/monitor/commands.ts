import type { CommandResult } from "../scheduler/commands.js";
import type { CursorAgentConfig, DeliveryTarget } from "../types.js";
import { getActiveMonitors } from "../db.js";
import { startMonitor, stopMonitor } from "./monitor.js";
import { isGhAvailable } from "./checker.js";

interface CommandContext {
  channelType?: string;
  channelId?: string;
}

export function handleMonitorCommand(
  input: string,
  ctx?: CommandContext,
  _config?: CursorAgentConfig,
): CommandResult | null | Promise<CommandResult> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/monitor")) return null;

  const rest = trimmed.slice(8).trim();

  if (!rest || rest === "help") {
    return { text: monitorHelp() };
  }

  if (rest === "list") {
    return monitorList();
  }

  if (rest === "stop" || rest.startsWith("stop ")) {
    return monitorStop(rest.slice(5).trim());
  }

  if (rest === "pr" || rest.startsWith("pr ")) {
    return monitorPr(rest.slice(rest.startsWith("pr ") ? 3 : 2).trim(), ctx);
  }

  return { text: monitorHelp() };
}

function monitorList(): CommandResult {
  const monitors = getActiveMonitors();
  if (monitors.length === 0) {
    return { text: "No active monitors. Use /monitor pr <branch> to start one." };
  }

  const lines = ["Active monitors:\n"];
  for (const m of monitors) {
    const autoFix = m.autoFix ? `  auto-fix (${m.retryCount}/${m.maxRetries})` : "";
    const pr = m.prNumber ? `  PR#${m.prNumber}` : "";
    lines.push(`  ${m.id}  ${m.branch}  [${m.ciStatus}]${pr}${autoFix}`);
    if (m.lastCheckAt) {
      lines.push(`    last check: ${m.lastCheckAt}`);
    }
  }
  return { text: lines.join("\n") };
}

function monitorPr(args: string, ctx?: CommandContext): CommandResult {
  if (!isGhAvailable()) {
    return { text: "Error: `gh` CLI is not available. Install GitHub CLI to use monitoring." };
  }

  let autoFix = false;
  let maxRetries = 3;

  if (args.includes("--auto-fix")) {
    autoFix = true;
    args = args.replace(/--auto-fix/, "").trim();
  }

  const retriesMatch = args.match(/--max-retries\s+(\d+)/);
  if (retriesMatch) {
    maxRetries = parseInt(retriesMatch[1], 10);
    args = args.replace(retriesMatch[0], "").trim();
  }

  const branch = args.split(/\s+/)[0];
  if (!branch) {
    return { text: "Usage: /monitor pr <branch> [--auto-fix] [--max-retries N]" };
  }

  const delivery: DeliveryTarget =
    ctx?.channelType && ctx?.channelId
      ? { kind: "channel", channelType: ctx.channelType, channelId: ctx.channelId }
      : { kind: "store" };

  const monitor = startMonitor(branch, { autoFix, maxRetries, delivery });
  const fixNote = autoFix ? ` with auto-fix (max ${maxRetries} retries)` : "";
  return { text: `Monitoring branch "${branch}" (id: ${monitor.id})${fixNote}` };
}

function monitorStop(args: string): CommandResult {
  const prefix = args.trim().split(/\s+/)[0];
  if (!prefix) {
    return { text: "Usage: /monitor stop <id-prefix>" };
  }

  const ok = stopMonitor(prefix);
  if (ok) {
    return { text: `Monitor stopped.` };
  }
  return { text: `No monitor matching "${prefix}" found.` };
}

function monitorHelp(): string {
  return [
    "Monitor commands:",
    "",
    "  /monitor pr <branch> [--auto-fix] [--max-retries N]  Monitor CI/PR status",
    "  /monitor list                                         List active monitors",
    "  /monitor stop <id-prefix>                             Stop a monitor",
  ].join("\n");
}
