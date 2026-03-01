import {
  addAgentRun,
  updateAgentRun,
  getAgentRun,
  getAgentRunsByParent,
  getActiveAgentRuns,
  getRecentAgentRuns,
  findAgentRunByIdPrefix,
} from "../db.js";
import type { AgentRun, AgentRunKind } from "../types.js";

/** Record a new agent run starting. Returns the run with generated ID. */
export function startRun(params: {
  kind: AgentRunKind;
  parentId?: string;
  label: string;
  cloudAgentId?: string;
}): AgentRun {
  return addAgentRun({
    kind: params.kind,
    parentId: params.parentId ?? null,
    label: params.label,
    cloudAgentId: params.cloudAgentId ?? null,
    status: "running",
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
  });
}

/** Mark a run as completed (success, error, or stopped). */
export function completeRun(
  runId: string,
  outcome: {
    status: "success" | "error" | "stopped";
    result?: string;
    error?: string;
  },
): void {
  updateAgentRun(runId, {
    status: outcome.status,
    result: outcome.result ?? null,
    error: outcome.error ?? null,
    completedAt: new Date().toISOString(),
  });
}

/** Get a formatted summary of recent runs for display. */
export function formatRunsList(runs: AgentRun[]): string {
  if (runs.length === 0) return "No agent runs.";

  const lines = ["Agent runs:\n"];
  for (const run of runs) {
    const statusIcon =
      run.status === "running" ? "⟳" :
      run.status === "success" ? "✓" :
      run.status === "error" ? "✗" : "■";
    const parent = run.parentId ? ` (${run.parentId})` : "";
    const cloud = run.cloudAgentId ? ` cloud:${run.cloudAgentId.slice(0, 8)}` : "";
    lines.push(
      `  ${run.id}  [${statusIcon} ${run.status}]  ${run.kind}${parent}  ${run.label.slice(0, 50)}${cloud}`,
    );
  }
  return lines.join("\n");
}

/** Get a formatted detail view of a single run. */
export function formatRunInfo(run: AgentRun): string {
  const lines = [
    `Run: ${run.id}`,
    `Kind: ${run.kind}`,
    `Status: ${run.status}`,
    `Label: ${run.label}`,
    `Started: ${run.startedAt}`,
  ];

  if (run.parentId) lines.push(`Parent: ${run.parentId}`);
  if (run.cloudAgentId) lines.push(`Cloud Agent: ${run.cloudAgentId}`);
  if (run.completedAt) lines.push(`Completed: ${run.completedAt}`);
  if (run.result) lines.push(`Result: ${run.result.slice(0, 500)}`);
  if (run.error) lines.push(`Error: ${run.error}`);

  return lines.join("\n");
}

// Re-export DB accessors for convenience
export { getAgentRun, getAgentRunsByParent, getActiveAgentRuns, getRecentAgentRuns, findAgentRunByIdPrefix };
