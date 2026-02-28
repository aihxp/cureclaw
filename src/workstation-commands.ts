import { spawn } from "node:child_process";
import {
  addWorkstation,
  removeWorkstation,
  getAllWorkstations,
  getWorkstation,
  setDefaultWorkstation,
} from "./db.js";
import { isValidWorkstationName } from "./workstation.js";
import type { Workstation } from "./types.js";

export interface WorkstationCommandResult {
  text: string;
}

/**
 * Handle /workstation commands.
 * Returns a result if input matched, null otherwise.
 */
export function handleWorkstationCommand(
  input: string,
): WorkstationCommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/workstation")) return null;

  const rest = trimmed.slice(12).trim();

  if (!rest || rest === "help") {
    return {
      text: `Workstation commands:
  /workstation list                          List registered workstations
  /workstation add <name> <user@host> <cwd>  Register a workstation
    [--port N] [--cursor-path P] [--key F]
  /workstation remove <name>                 Remove a workstation
  /workstation default <name|local>          Set default workstation
  /workstation status <name>                 Test SSH connectivity

Use @name before a prompt to target a workstation:
  @dev explain this project`,
    };
  }

  if (rest === "list") {
    return handleList();
  }

  if (rest.startsWith("add ")) {
    return handleAdd(rest.slice(4).trim());
  }

  if (rest.startsWith("remove ")) {
    return handleRemove(rest.slice(7).trim());
  }

  if (rest.startsWith("default ")) {
    return handleDefault(rest.slice(8).trim());
  }

  if (rest.startsWith("status ")) {
    return handleStatus(rest.slice(7).trim());
  }

  return {
    text: `Unknown workstation subcommand. Type /workstation for usage.`,
  };
}

function handleList(): WorkstationCommandResult {
  const workstations = getAllWorkstations();
  if (workstations.length === 0) {
    return { text: "No workstations registered." };
  }

  const lines = ["Workstations:\n"];
  for (const ws of workstations) {
    const defaultMarker = ws.isDefault ? " (default)" : "";
    const userHost = ws.user ? `${ws.user}@${ws.host}` : ws.host;
    const port = ws.port && ws.port !== 22 ? `:${ws.port}` : "";
    lines.push(
      `  ${ws.name}${defaultMarker}  ${userHost}${port}  ${ws.cwd}`,
    );
  }

  return { text: lines.join("\n") };
}

function handleAdd(args: string): WorkstationCommandResult {
  // Parse: <name> <user@host> <cwd> [--port N] [--cursor-path P] [--key F]
  const parts = args.split(/\s+/);
  if (parts.length < 3) {
    return {
      text: "Usage: /workstation add <name> <user@host> <cwd> [--port N] [--cursor-path P] [--key F]",
    };
  }

  const name = parts[0];
  const hostSpec = parts[1];
  const cwd = parts[2];

  if (!isValidWorkstationName(name)) {
    return {
      text: "Invalid name. Use lowercase letters, numbers, and hyphens (1-64 chars, must start with alphanumeric).",
    };
  }

  if (getWorkstation(name)) {
    return { text: `Workstation "${name}" already exists. Remove it first.` };
  }

  // Parse user@host
  let user: string | undefined;
  let host: string;
  if (hostSpec.includes("@")) {
    const at = hostSpec.indexOf("@");
    user = hostSpec.slice(0, at);
    host = hostSpec.slice(at + 1);
  } else {
    host = hostSpec;
  }

  // Parse optional flags
  let port: number | undefined;
  let cursorPath: string | undefined;
  let identityFile: string | undefined;

  for (let i = 3; i < parts.length; i++) {
    if (parts[i] === "--port" && parts[i + 1]) {
      port = parseInt(parts[++i], 10);
    } else if (parts[i] === "--cursor-path" && parts[i + 1]) {
      cursorPath = parts[++i];
    } else if (parts[i] === "--key" && parts[i + 1]) {
      identityFile = parts[++i];
    }
  }

  const ws: Workstation = { name, host, user, port, cursorPath, cwd, identityFile };
  addWorkstation(ws);

  const userHost = user ? `${user}@${host}` : host;
  return {
    text: `Workstation "${name}" added (${userHost}, cwd: ${cwd}).`,
  };
}

function handleRemove(name: string): WorkstationCommandResult {
  if (!name) {
    return { text: "Usage: /workstation remove <name>" };
  }

  const removed = removeWorkstation(name);
  if (!removed) {
    return { text: `Workstation "${name}" not found.` };
  }
  return { text: `Workstation "${name}" removed.` };
}

function handleDefault(name: string): WorkstationCommandResult {
  if (!name) {
    return { text: "Usage: /workstation default <name|local>" };
  }

  if (name === "local") {
    // Clear all defaults
    const all = getAllWorkstations();
    for (const ws of all) {
      if (ws.isDefault) {
        setDefaultWorkstation("__none__"); // clears all
      }
    }
    return { text: "Default cleared. Prompts will run locally." };
  }

  const ws = getWorkstation(name);
  if (!ws) {
    return { text: `Workstation "${name}" not found.` };
  }

  setDefaultWorkstation(name);
  return { text: `Default workstation set to "${name}".` };
}

function handleStatus(name: string): WorkstationCommandResult {
  if (!name) {
    return { text: "Usage: /workstation status <name>" };
  }

  const ws = getWorkstation(name);
  if (!ws) {
    return { text: `Workstation "${name}" not found.` };
  }

  // Return sync result; the actual SSH check is async.
  // We'll print immediately and let the caller handle the test.
  const userHost = ws.user ? `${ws.user}@${ws.host}` : ws.host;
  return {
    text: `Testing SSH connection to ${userHost}...`,
  };
}

/**
 * Async SSH connectivity test. Call this separately from the sync command handler.
 */
export function testWorkstationConnectivity(
  name: string,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const ws = getWorkstation(name);
    if (!ws) {
      resolve({ ok: false, output: `Workstation "${name}" not found.` });
      return;
    }

    const sshArgs: string[] = [];
    sshArgs.push("-o", "StrictHostKeyChecking=accept-new");
    sshArgs.push("-o", "BatchMode=yes");
    sshArgs.push("-o", "ConnectTimeout=10");
    if (ws.identityFile) sshArgs.push("-i", ws.identityFile);
    if (ws.port && ws.port !== 22) sshArgs.push("-p", String(ws.port));

    const userHost = ws.user ? `${ws.user}@${ws.host}` : ws.host;
    const remoteCursor = ws.cursorPath || "cursor";
    sshArgs.push(userHost, `echo ok && ${remoteCursor} --version`);

    const proc = spawn("ssh", sshArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0 && stdout.includes("ok")) {
        resolve({ ok: true, output: stdout.trim() });
      } else {
        resolve({ ok: false, output: stderr.trim() || `Exit code ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, output: err.message });
    });
  });
}
