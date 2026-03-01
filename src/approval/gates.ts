import type { ApprovalGate, ApprovalAction } from "../types.js";
import { getAllApprovalGates } from "../db.js";

/**
 * Check a tool call or command against all enabled gates.
 * Returns the action for the first matching gate, or "allow" if none match.
 */
export function checkApproval(toolName: string, description: string): ApprovalAction {
  const gate = findMatchingGate(toolName, description);
  return gate ? gate.action : "allow";
}

/**
 * Get the gate that matched (if any).
 * First match wins (gates checked in creation order).
 */
export function findMatchingGate(toolName: string, description: string): ApprovalGate | undefined {
  const gates = getAllApprovalGates();
  const target = `${toolName} ${description}`;

  for (const gate of gates) {
    if (!gate.enabled) continue;
    try {
      const regex = new RegExp(gate.pattern);
      if (regex.test(target)) {
        return gate;
      }
    } catch {
      // Invalid regex — skip this gate
    }
  }

  return undefined;
}

/** Format gates list for display. */
export function formatGatesList(gates: ApprovalGate[]): string {
  if (gates.length === 0) return "No approval gates configured.";

  const lines = ["Approval gates:\n"];
  for (const g of gates) {
    const status = g.enabled ? "on" : "off";
    lines.push(`  ${g.id}  [${status}]  ${g.name}  /${g.pattern}/  → ${g.action}`);
    lines.push(`         ${g.reason}`);
  }
  return lines.join("\n");
}

/** Format single gate detail. */
export function formatGateInfo(gate: ApprovalGate): string {
  return [
    `ID: ${gate.id}`,
    `Name: ${gate.name}`,
    `Pattern: /${gate.pattern}/`,
    `Action: ${gate.action}`,
    `Reason: ${gate.reason}`,
    `Enabled: ${gate.enabled ? "yes" : "no"}`,
    `Created: ${gate.createdAt}`,
  ].join("\n");
}
