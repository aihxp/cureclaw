import type { CommandContext, CommandResult } from "../scheduler/commands.js";
import type { ApprovalAction, DeliveryTarget } from "../types.js";
import {
  addApprovalGate,
  getAllApprovalGates,
  findApprovalGateByIdPrefix,
  removeApprovalGate,
  updateApprovalGate,
} from "../db.js";
import { formatGatesList } from "./gates.js";

const VALID_ACTIONS = ["allow", "deny", "ask"] as const;

/**
 * Handle /approval commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleApprovalCommand(input: string, ctx: CommandContext): CommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/approval")) return null;

  const rest = trimmed.slice(9).trim();

  if (rest === "" || rest === "help") {
    return {
      text: [
        "Approval gate commands:",
        '  /approval add <name> <pattern> <allow|deny|ask> "reason"',
        "  /approval list                  List all gates",
        "  /approval remove <id-prefix>    Remove a gate",
        "  /approval enable <id-prefix>    Enable a gate",
        "  /approval disable <id-prefix>   Disable a gate",
      ].join("\n"),
    };
  }

  if (rest === "list") {
    const gates = getAllApprovalGates();
    return { text: formatGatesList(gates) };
  }

  if (rest === "add" || rest.startsWith("add ")) {
    return handleAdd(rest.slice(3).trim(), ctx);
  }

  if (rest.startsWith("remove ")) {
    return handleRemove(rest.slice(7).trim());
  }

  if (rest.startsWith("enable ")) {
    return handleToggle(rest.slice(7).trim(), true);
  }

  if (rest.startsWith("disable ")) {
    return handleToggle(rest.slice(8).trim(), false);
  }

  return { text: "Unknown approval subcommand. Type /approval help for usage." };
}

function handleAdd(args: string, ctx: CommandContext): CommandResult {
  // Parse: <name> <pattern> <allow|deny|ask> "reason"
  const match = args.match(/^(\S+)\s+(\S+)\s+(allow|deny|ask)\s+"((?:[^"\\]|\\.)*)"/);
  if (!match) {
    // Try without quotes around reason
    const simpleMatch = args.match(/^(\S+)\s+(\S+)\s+(allow|deny|ask)\s+(.+)$/);
    if (!simpleMatch) {
      return { text: 'Usage: /approval add <name> <pattern> <allow|deny|ask> "reason"' };
    }
    const [, name, pattern, action, reason] = simpleMatch;
    return createGate(name, pattern, action as ApprovalAction, reason, ctx);
  }

  const [, name, pattern, action, reason] = match;
  return createGate(name, pattern, action as ApprovalAction, reason.replace(/\\"/g, '"'), ctx);
}

function createGate(name: string, pattern: string, action: ApprovalAction, reason: string, ctx: CommandContext): CommandResult {
  // Validate regex
  try {
    new RegExp(pattern);
  } catch {
    return { text: `Invalid regex pattern: "${pattern}"` };
  }

  const delivery: DeliveryTarget =
    ctx.channelType === "cli"
      ? { kind: "store" }
      : { kind: "channel", channelType: ctx.channelType, channelId: ctx.channelId };

  const gate = addApprovalGate({
    name,
    pattern,
    action,
    reason,
    delivery,
    enabled: true,
    createdAt: new Date().toISOString(),
  });

  return { text: `Approval gate "${gate.name}" (${gate.id}) created: /${pattern}/ → ${action}` };
}

function handleRemove(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /approval remove <id-prefix>" };
  }

  const gate = findApprovalGateByIdPrefix(idPrefix);
  if (!gate) {
    return { text: `No gate found matching "${idPrefix}".` };
  }

  removeApprovalGate(gate.id);
  return { text: `Gate "${gate.name}" (${gate.id}) removed.` };
}

function handleToggle(idPrefix: string, enabled: boolean): CommandResult {
  if (!idPrefix) {
    return { text: `Usage: /approval ${enabled ? "enable" : "disable"} <id-prefix>` };
  }

  const gate = findApprovalGateByIdPrefix(idPrefix);
  if (!gate) {
    return { text: `No gate found matching "${idPrefix}".` };
  }

  updateApprovalGate(gate.id, { enabled });
  return { text: `Gate "${gate.name}" (${gate.id}) ${enabled ? "enabled" : "disabled"}.` };
}
