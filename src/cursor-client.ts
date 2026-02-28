import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import type { CursorAgentConfig, CursorStreamEvent } from "./types.js";

export interface CursorProcess {
  proc: ChildProcess;
  lines: AsyncIterable<string>;
  stderr: () => string;
}

export function spawnCursor(
  prompt: string,
  config: CursorAgentConfig,
  signal?: AbortSignal,
): CursorProcess {
  const args = [
    "agent",
    "--print",
    "--output-format",
    "stream-json",
    "--trust",
  ];

  if (config.streamPartialOutput !== false) {
    args.push("--stream-partial-output");
  }
  if (config.model) {
    args.push("--model", config.model);
  }
  if (config.autoApprove) {
    args.push("--yolo");
  }
  if (config.cloud) {
    args.push("--cloud");
  }
  if (config.sessionId) {
    args.push("--resume", config.sessionId);
  }
  if (config.extraArgs) {
    args.push(...config.extraArgs);
  }

  // Prompt as positional arg
  args.push(prompt);

  const proc = spawn(config.cursorPath, args, {
    cwd: config.cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  // Handle abort signal
  if (signal) {
    const onAbort = () => {
      proc.kill("SIGTERM");
      // Follow up with SIGKILL after 3s if still alive
      const killTimer = setTimeout(() => proc.kill("SIGKILL"), 3000);
      proc.on("close", () => clearTimeout(killTimer));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    proc.on("close", () => signal.removeEventListener("abort", onAbort));
  }

  // Collect stderr
  let stderrBuf = "";
  proc.stderr?.on("data", (data: Buffer) => {
    stderrBuf += data.toString();
  });

  // Create async line iterator from stdout
  const rl = readline.createInterface({
    input: proc.stdout!,
    terminal: false,
  });

  const lines = (async function* () {
    for await (const line of rl) {
      yield line;
    }
  })();

  return {
    proc,
    lines,
    stderr: () => stderrBuf,
  };
}

export function parseCursorEvent(line: string): CursorStreamEvent | null {
  try {
    return JSON.parse(line) as CursorStreamEvent;
  } catch {
    return null;
  }
}
