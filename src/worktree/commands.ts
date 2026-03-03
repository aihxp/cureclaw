import type { CommandResult } from "../scheduler/commands.js";
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  cleanupWorktrees,
} from "./worktree.js";

export function handleWorktreeCommand(
  input: string,
): CommandResult | null | Promise<CommandResult> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/worktree")) return null;

  const rest = trimmed.slice(9).trim();

  if (!rest || rest === "help") {
    return { text: worktreeHelp() };
  }

  if (rest === "list") {
    return worktreeList();
  }

  if (rest === "cleanup") {
    return worktreeCleanup();
  }

  if (rest === "create") {
    return { text: "Usage: /worktree create <branch> [--base <ref>]" };
  }
  if (rest.startsWith("create ")) {
    return worktreeCreate(rest.slice(7).trim());
  }

  if (rest === "remove") {
    return { text: "Usage: /worktree remove <branch>" };
  }
  if (rest.startsWith("remove ")) {
    return worktreeRemove(rest.slice(7).trim());
  }

  return { text: worktreeHelp() };
}

function worktreeList(): CommandResult {
  const worktrees = listWorktrees();
  if (worktrees.length === 0) {
    return { text: "No active worktrees. Use /worktree create <branch> to create one." };
  }

  const lines = ["Active worktrees:\n"];
  for (const wt of worktrees) {
    const task = wt.taskId ? `  task:${wt.taskId}` : "";
    lines.push(`  ${wt.branch}  [${wt.status}]  base:${wt.baseBranch}${task}`);
    lines.push(`    ${wt.path}`);
  }
  return { text: lines.join("\n") };
}

async function worktreeCreate(args: string): Promise<CommandResult> {
  let base: string | undefined;
  const baseMatch = args.match(/--base\s+(\S+)/);
  if (baseMatch) {
    base = baseMatch[1];
    args = args.replace(baseMatch[0], "").trim();
  }

  const branch = args.split(/\s+/)[0];
  if (!branch) {
    return { text: "Usage: /worktree create <branch> [--base <ref>]" };
  }

  try {
    const wt = await createWorktree(branch, { base });
    return { text: `Worktree created: ${wt.branch} at ${wt.path} (base: ${wt.baseBranch})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error creating worktree: ${msg}` };
  }
}

async function worktreeRemove(args: string): Promise<CommandResult> {
  const branch = args.trim().split(/\s+/)[0];
  if (!branch) {
    return { text: "Usage: /worktree remove <branch>" };
  }

  try {
    const removed = await removeWorktree(branch);
    if (removed) {
      return { text: `Worktree "${branch}" removed.` };
    }
    return { text: `Worktree "${branch}" not found.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error removing worktree: ${msg}` };
  }
}

async function worktreeCleanup(): Promise<CommandResult> {
  try {
    const { removed } = await cleanupWorktrees();
    if (removed.length === 0) {
      return { text: "No stale worktrees found." };
    }
    return { text: `Cleaned up ${removed.length} stale worktree(s): ${removed.join(", ")}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error during cleanup: ${msg}` };
  }
}

function worktreeHelp(): string {
  return [
    "Worktree commands:",
    "",
    "  /worktree create <branch> [--base <ref>]  Create isolated worktree",
    "  /worktree list                             List active worktrees",
    "  /worktree remove <branch>                  Remove a worktree",
    "  /worktree cleanup                          Prune stale worktrees",
  ].join("\n");
}
