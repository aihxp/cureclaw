import type { CommandResult } from "../scheduler/commands.js";
import {
  spawnProcess,
  killProcess,
  steerProcess,
  readLog,
  listProcesses,
} from "./manager.js";
import { getWorktreeCwd } from "../worktree/worktree.js";

export function handleSpawnCommand(
  input: string,
): CommandResult | null | Promise<CommandResult> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/spawn")) return null;

  const rest = trimmed.slice(6).trim();

  if (!rest || rest === "help") {
    return { text: spawnHelp() };
  }

  if (rest === "list") {
    return spawnList();
  }

  if (rest === "steer") {
    return { text: 'Usage: /spawn steer <name> "message"' };
  }
  if (rest.startsWith("steer ")) {
    return spawnSteer(rest.slice(6).trim());
  }

  if (rest === "kill") {
    return { text: "Usage: /spawn kill <name>" };
  }
  if (rest.startsWith("kill ")) {
    return spawnKill(rest.slice(5).trim());
  }

  if (rest === "log") {
    return { text: "Usage: /spawn log <name> [lines]" };
  }
  if (rest.startsWith("log ")) {
    return spawnLog(rest.slice(4).trim());
  }

  // /spawn <name> <command...> [--worktree <branch>]
  return spawnStart(rest);
}

function spawnList(): CommandResult {
  const procs = listProcesses();
  if (procs.length === 0) {
    return { text: "No spawned processes." };
  }

  const lines = ["Spawned processes:\n"];
  for (const p of procs) {
    const pid = p.pid ? `pid:${p.pid}` : "no-pid";
    const exit = p.exitCode !== null ? `  exit:${p.exitCode}` : "";
    lines.push(`  ${p.name}  [${p.status}]  ${pid}${exit}`);
    lines.push(`    cmd: ${p.command}`);
    lines.push(`    cwd: ${p.cwd}`);
  }
  return { text: lines.join("\n") };
}

async function spawnStart(args: string): Promise<CommandResult> {
  let worktreeBranch: string | undefined;
  const wtMatch = args.match(/--worktree\s+(\S+)/);
  if (wtMatch) {
    worktreeBranch = wtMatch[1];
    args = args.replace(wtMatch[0], "").trim();
  }

  const spaceIdx = args.indexOf(" ");
  if (spaceIdx === -1) {
    return { text: "Usage: /spawn <name> <command...> [--worktree <branch>]" };
  }

  const name = args.slice(0, spaceIdx);
  const command = args.slice(spaceIdx + 1).trim();

  if (!command) {
    return { text: "Usage: /spawn <name> <command...> [--worktree <branch>]" };
  }

  let cwd: string | undefined;
  let worktreeId: string | undefined;
  if (worktreeBranch) {
    cwd = getWorktreeCwd(worktreeBranch) ?? undefined;
    if (!cwd) {
      return { text: `Worktree "${worktreeBranch}" not found or not active.` };
    }
    // Get worktree ID for tracking
    const { getWorktreeByBranch } = await import("../db.js");
    const wt = getWorktreeByBranch(worktreeBranch);
    worktreeId = wt?.id;
  }

  try {
    const proc = await spawnProcess(name, command, { worktreeId, cwd });
    return { text: `Process "${name}" spawned (id: ${proc.id}, pid: ${proc.pid ?? "unknown"})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error spawning process: ${msg}` };
  }
}

function spawnSteer(args: string): CommandResult {
  const match = args.match(/^(\S+)\s+(.+)$/s);
  if (!match) {
    return { text: 'Usage: /spawn steer <name> "message"' };
  }

  const name = match[1];
  let message = match[2].trim();

  // Strip surrounding quotes
  if ((message.startsWith('"') && message.endsWith('"')) || (message.startsWith("'") && message.endsWith("'"))) {
    message = message.slice(1, -1);
  }

  const ok = steerProcess(name, message);
  if (ok) {
    return { text: `Message sent to "${name}".` };
  }
  return { text: `Cannot steer "${name}" — not running or no stdin.` };
}

function spawnKill(args: string): CommandResult {
  const name = args.trim().split(/\s+/)[0];
  if (!name) {
    return { text: "Usage: /spawn kill <name>" };
  }

  const ok = killProcess(name);
  if (ok) {
    return { text: `Process "${name}" killed.` };
  }
  return { text: `Process "${name}" not found.` };
}

function spawnLog(args: string): CommandResult {
  const parts = args.trim().split(/\s+/);
  const name = parts[0];
  if (!name) {
    return { text: "Usage: /spawn log <name> [lines]" };
  }

  const lines = parts[1] ? parseInt(parts[1], 10) : 50;
  const output = readLog(name, isNaN(lines) ? 50 : lines);
  return { text: `Log for "${name}":\n\n${output}` };
}

function spawnHelp(): string {
  return [
    "Spawn commands:",
    "",
    "  /spawn <name> <command...> [--worktree <branch>]  Start a background process",
    "  /spawn list                                        List all spawned processes",
    '  /spawn steer <name> "message"                      Write to process stdin',
    "  /spawn kill <name>                                 Kill a running process",
    "  /spawn log <name> [lines]                          Read process log output",
  ].join("\n");
}
