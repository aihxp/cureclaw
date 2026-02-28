import { getWorkstation, getDefaultWorkstation } from "./db.js";
import type { Workstation } from "./types.js";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidWorkstationName(name: string): boolean {
  return NAME_RE.test(name);
}

/**
 * Resolve which workstation to use.
 * Priority: explicit name > configWorkstation > default workstation > undefined (local).
 * "local" is a magic name meaning no workstation (override default).
 */
export function resolveWorkstation(
  explicit?: string,
  configWorkstation?: string,
): Workstation | undefined {
  const name = explicit ?? configWorkstation;

  // "local" magic name forces local execution
  if (name === "local") return undefined;

  // If a name is specified, look it up
  if (name) {
    const ws = getWorkstation(name);
    if (ws) return ws;
    throw new Error(`Unknown workstation: ${name}`);
  }

  // No name specified — fall back to default workstation
  return getDefaultWorkstation();
}
