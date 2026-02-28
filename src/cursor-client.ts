import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import type { CursorAgentConfig, CursorStreamEvent, Workstation } from "./types.js";

export interface CursorProcess {
  proc: ChildProcess;
  lines: AsyncIterable<string>;
  stderr: () => string;
}

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function buildCursorArgs(prompt: string, config: CursorAgentConfig): string[] {
  const args = ["agent", "--print", "--output-format", "stream-json", "--trust"];

  if (config.streamPartialOutput !== false) {
    args.push("--stream-partial-output");
  }
  if (config.model) {
    args.push("--model", config.model);
  }
  if (config.autoApprove) {
    args.push("--yolo");
    args.push("--approve-mcps");
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

  args.push(prompt);
  return args;
}

function spawnRemote(
  cursorArgs: string[],
  config: CursorAgentConfig,
  ws: Workstation,
): ChildProcess {
  const remoteCursor = ws.cursorPath || "cursor";
  const remoteCwd = config.cwd || ws.cwd;
  const escapedArgs = cursorArgs.map(shellEscape);
  const remoteCmd = `cd ${shellEscape(remoteCwd)} && ${shellEscape(remoteCursor)} ${escapedArgs.join(" ")}`;

  const sshArgs: string[] = [];
  sshArgs.push("-o", "StrictHostKeyChecking=accept-new");
  sshArgs.push("-o", "BatchMode=yes");
  sshArgs.push("-o", "ConnectTimeout=10");
  if (ws.identityFile) sshArgs.push("-i", ws.identityFile);
  if (ws.port && ws.port !== 22) sshArgs.push("-p", String(ws.port));

  const userHost = ws.user ? `${ws.user}@${ws.host}` : ws.host;
  sshArgs.push(userHost, remoteCmd);

  return spawn("ssh", sshArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
}

export function spawnCursor(
  prompt: string,
  config: CursorAgentConfig,
  signal?: AbortSignal,
  workstation?: Workstation,
): CursorProcess {
  const args = buildCursorArgs(prompt, config);

  let proc: ChildProcess;
  if (workstation) {
    proc = spawnRemote(args, config, workstation);
  } else {
    proc = spawn(config.cursorPath, args, {
      cwd: config.cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
  }

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
