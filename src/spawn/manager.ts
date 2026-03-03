import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SpawnedProcess } from "../types.js";
import {
  addSpawnedProcess,
  getSpawnedByName,
  getRunningSpawned,
  getAllSpawned,
  updateSpawnedProcess,
} from "../db.js";

const DEFAULT_DATA_DIR = path.join(os.homedir(), ".cureclaw");

function getLogDir(): string {
  const dir = process.env.CURECLAW_DATA_DIR || DEFAULT_DATA_DIR;
  const logDir = path.join(dir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  return logDir;
}

/** Module-level tracking of live child processes. */
const liveProcesses = new Map<string, { proc: ChildProcess; name: string }>();

export async function spawnProcess(
  name: string,
  command: string,
  options?: { worktreeId?: string; cwd?: string },
): Promise<SpawnedProcess> {
  const existing = getSpawnedByName(name);
  if (existing && existing.status === "running") {
    throw new Error(`Process "${name}" is already running (pid: ${existing.pid})`);
  }

  const cwd = options?.cwd || process.cwd();
  const logFile = path.join(getLogDir(), `${name}.log`);

  const logStream = fs.createWriteStream(logFile, { flags: "a" });

  const proc = nodeSpawn(command, {
    shell: true,
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (proc.stdout) {
    proc.stdout.pipe(logStream);
  }
  if (proc.stderr) {
    proc.stderr.pipe(logStream);
  }

  const record = addSpawnedProcess({
    name,
    command,
    pid: proc.pid ?? null,
    logFile,
    worktreeId: options?.worktreeId ?? null,
    cwd,
    status: "running",
    createdAt: new Date().toISOString(),
  });

  liveProcesses.set(record.id, { proc, name });

  proc.on("exit", (code) => {
    logStream.end();
    updateSpawnedProcess(record.id, {
      status: "exited",
      exitCode: code ?? null,
      stoppedAt: new Date().toISOString(),
    });
    liveProcesses.delete(record.id);
  });

  proc.on("error", () => {
    logStream.end();
    updateSpawnedProcess(record.id, {
      status: "exited",
      exitCode: -1,
      stoppedAt: new Date().toISOString(),
    });
    liveProcesses.delete(record.id);
  });

  return record;
}

export function killProcess(name: string): boolean {
  const record = getSpawnedByName(name);
  if (!record) return false;

  const live = liveProcesses.get(record.id);
  if (live) {
    live.proc.kill("SIGTERM");
    liveProcesses.delete(record.id);
  }

  updateSpawnedProcess(record.id, {
    status: "stopped",
    stoppedAt: new Date().toISOString(),
  });

  return true;
}

export function steerProcess(name: string, message: string): boolean {
  const record = getSpawnedByName(name);
  if (!record) return false;

  const live = liveProcesses.get(record.id);
  if (!live || !live.proc.stdin) return false;

  live.proc.stdin.write(message + "\n");
  return true;
}

export function readLog(name: string, lines = 50): string {
  const record = getSpawnedByName(name);
  if (!record) return `Process "${name}" not found.`;

  try {
    if (!fs.existsSync(record.logFile)) return "(no log file)";
    const content = fs.readFileSync(record.logFile, "utf-8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  } catch {
    return "(error reading log)";
  }
}

export function listProcesses(): SpawnedProcess[] {
  return getAllSpawned();
}

export function reconcileProcesses(): void {
  const running = getRunningSpawned();
  for (const proc of running) {
    if (liveProcesses.has(proc.id)) continue;

    // Check if PID is still alive
    if (proc.pid) {
      try {
        process.kill(proc.pid, 0);
        // PID exists but we don't have a handle — mark as exited
      } catch {
        // PID doesn't exist
      }
    }

    updateSpawnedProcess(proc.id, {
      status: "exited",
      stoppedAt: new Date().toISOString(),
    });
  }
}
