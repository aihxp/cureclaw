import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GitWorktree } from "../types.js";
import {
  addWorktree,
  getWorktreeByBranch,
  getActiveWorktrees,
  updateWorktreeRecord,
} from "../db.js";

function getRepoRoot(): string {
  return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", timeout: 10_000 }).trim();
}

function detectPackageManager(repoRoot: string): string {
  if (fs.existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(repoRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

export async function createWorktree(
  branch: string,
  options?: { base?: string; taskId?: string },
): Promise<GitWorktree> {
  const base = options?.base ?? "main";

  const existing = getWorktreeByBranch(branch);
  if (existing && existing.status === "active") {
    throw new Error(`Worktree for branch "${branch}" already exists at ${existing.path}`);
  }

  const repoRoot = getRepoRoot();
  const repoName = path.basename(repoRoot);
  const worktreePath = path.resolve(repoRoot, "..", `${repoName}-${branch}`);

  execSync(`git worktree add -b "${branch}" "${worktreePath}" "${base}"`, {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: 60_000,
  });

  const pm = detectPackageManager(repoRoot);
  if (fs.existsSync(path.join(worktreePath, "package.json"))) {
    try {
      execSync(`${pm} install`, {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 120_000,
        stdio: "pipe",
      });
    } catch {
      // Non-fatal — worktree still usable without deps installed
    }
  }

  const wt = addWorktree({
    branch,
    path: worktreePath,
    baseBranch: base,
    taskId: options?.taskId ?? null,
    status: "active",
    createdAt: new Date().toISOString(),
  });

  return wt;
}

export async function removeWorktree(branch: string): Promise<boolean> {
  const wt = getWorktreeByBranch(branch);
  if (!wt) return false;

  try {
    const repoRoot = getRepoRoot();
    execSync(`git worktree remove "${wt.path}" --force`, {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: "pipe",
    });
  } catch {
    // If git worktree remove fails, try cleaning up the directory
    try {
      if (fs.existsSync(wt.path)) {
        fs.rmSync(wt.path, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup failures
    }
  }

  updateWorktreeRecord(wt.id, {
    status: "removed",
    removedAt: new Date().toISOString(),
  });

  return true;
}

export function listWorktrees(): GitWorktree[] {
  return getActiveWorktrees();
}

export async function cleanupWorktrees(): Promise<{ removed: string[] }> {
  const active = getActiveWorktrees();
  const removed: string[] = [];

  for (const wt of active) {
    if (!fs.existsSync(wt.path)) {
      updateWorktreeRecord(wt.id, {
        status: "removed",
        removedAt: new Date().toISOString(),
      });
      removed.push(wt.branch);
    }
  }

  // Also run git worktree prune
  try {
    const repoRoot = getRepoRoot();
    execSync("git worktree prune", {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: "pipe",
    });
  } catch {
    // Non-fatal
  }

  return { removed };
}

export function getWorktreeCwd(branch: string): string | null {
  const wt = getWorktreeByBranch(branch);
  if (!wt || wt.status !== "active") return null;
  return wt.path;
}
