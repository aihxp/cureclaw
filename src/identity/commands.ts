import type { CommandResult } from "../scheduler/commands.js";
import {
  resolveIdentity,
  setIdentityField,
  formatIdentity,
  formatIdentityList,
  getAllIdentities,
} from "./identity.js";
import { getIdentityByScope, removeIdentity as dbRemoveIdentity } from "../db.js";

/**
 * Handle /identity commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleIdentityCommand(input: string): CommandResult | null {
  const trimmed = input.trim();

  if (trimmed === "/identity" || trimmed === "/identity help") {
    return { text: identityHelp() };
  }

  if (trimmed === "/identity list") {
    const identities = getAllIdentities();
    return { text: formatIdentityList(identities) };
  }

  if (trimmed === "/identity show" || trimmed.startsWith("/identity show ")) {
    return showIdentity(trimmed.slice(14).trim());
  }

  if (trimmed.startsWith("/identity set ")) {
    return setIdentity(trimmed.slice(14).trim());
  }

  if (trimmed.startsWith("/identity remove ")) {
    return removeIdentity(trimmed.slice(17).trim());
  }

  return null;
}

function showIdentity(args: string): CommandResult {
  let scope: string | undefined;
  const scopeMatch = args.match(/--scope\s+(\S+)/);
  if (scopeMatch) {
    scope = scopeMatch[1];
  }

  const identity = scope ? getIdentityByScope(scope) : resolveIdentity();
  if (!identity) {
    return { text: scope ? `No identity found for scope "${scope}".` : "No identity configured. Use /identity set name \"YourName\" to create one." };
  }
  return { text: formatIdentity(identity) };
}

function setIdentity(args: string): CommandResult {
  // Parse: <field> <value> [--scope <scope>]
  let scope: string | undefined;
  const scopeMatch = args.match(/--scope\s+(\S+)/);
  if (scopeMatch) {
    scope = scopeMatch[1];
    args = args.replace(scopeMatch[0], "").trim();
  }

  // Parse field name
  const parts = args.match(/^(name|greeting|prompt|avatar)\s+(.+)$/s);
  if (!parts) {
    return { text: 'Usage: /identity set <name|greeting|prompt|avatar> <value> [--scope <scope>]\nExample: /identity set name "CureClaw"' };
  }

  const field = parts[1] as "name" | "greeting" | "prompt" | "avatar";
  let value = parts[2].trim();

  // Strip surrounding quotes if present
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  if (!value) {
    return { text: `Value for "${field}" cannot be empty.` };
  }

  const identity = setIdentityField(field, value, scope);
  return { text: `Identity ${field} set for scope "${identity.scope}": ${value.slice(0, 100)}${value.length > 100 ? "..." : ""}` };
}

function removeIdentity(scope: string): CommandResult {
  const identity = getIdentityByScope(scope);
  if (!identity) {
    return { text: `No identity found for scope "${scope}".` };
  }
  dbRemoveIdentity(identity.id);
  return { text: `Identity for scope "${scope}" removed.` };
}

function identityHelp(): string {
  return [
    "Identity commands:",
    "",
    '  /identity set name "CureClaw"                    Set global name',
    '  /identity set name "SlackBot" --scope slack       Per-channel override',
    '  /identity set greeting "Hello! I\'m your assistant."  Greeting message',
    '  /identity set prompt "You are a helpful..."       System prompt',
    '  /identity set avatar "https://..."                Avatar URL',
    "  /identity show                                    Show resolved identity",
    "  /identity show --scope slack                      Show channel-specific",
    "  /identity list                                    List all identities",
    "  /identity remove <scope>                          Remove a channel override",
    "  /identity help                                    Show this help",
  ].join("\n");
}
