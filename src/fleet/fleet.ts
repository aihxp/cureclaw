import { addFleet, getFleet, updateFleet, getAgentRunsByParent } from "../db.js";
import { CloudClient, getCloudClient } from "../cloud/client.js";
import type { LaunchAgentRequest } from "../cloud/types.js";
import { startRun, completeRun } from "./registry.js";
import type { CursorAgentConfig, DeliveryTarget, Fleet } from "../types.js";

export interface FleetOptions {
  repository: string;
  tasks: string[];
  model?: string;
  createPr?: boolean;
  delivery: DeliveryTarget;
}

/** Launch a fleet of parallel cloud agents. Returns fleet record. */
export async function launchFleet(
  options: FleetOptions,
  _config: CursorAgentConfig,
): Promise<Fleet> {
  const client = getCloudClient();
  if (!client) {
    throw new Error("CURSOR_API_KEY is required for fleet operations");
  }

  const name =
    options.tasks.length === 1
      ? options.tasks[0].slice(0, 40)
      : `Fleet (${options.tasks.length} tasks)`;

  const fleet = addFleet({
    name,
    repository: options.repository,
    tasks: options.tasks,
    model: options.model ?? null,
    status: "running",
    delivery: options.delivery,
    createdAt: new Date().toISOString(),
    workerCount: options.tasks.length,
  });

  // Launch agents in parallel
  const requests: LaunchAgentRequest[] = options.tasks.map((task) => ({
    prompt: { text: task },
    model: options.model ?? undefined,
    source: { repository: options.repository },
    target: options.createPr ? { autoCreatePr: true } : undefined,
  }));

  const results = await client.launchAgents(requests);

  // Create agent runs for each worker
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.agent) {
      startRun({
        kind: "fleet",
        parentId: fleet.id,
        label: options.tasks[i],
        cloudAgentId: r.agent.id,
      });
    } else {
      const run = startRun({
        kind: "fleet",
        parentId: fleet.id,
        label: options.tasks[i],
      });
      completeRun(run.id, { status: "error", error: r.error ?? "Launch failed" });
    }
  }

  return fleet;
}

/** Monitor a running fleet. Polls cloud agents, updates runs, returns when all done. */
export async function monitorFleet(
  fleet: Fleet,
  _config: CursorAgentConfig,
  signal?: AbortSignal,
): Promise<{ success: boolean; summary: string }> {
  const client = getCloudClient();
  if (!client) {
    throw new Error("CURSOR_API_KEY is required for fleet operations");
  }

  const runs = getAgentRunsByParent(fleet.id);
  const activeRuns = runs.filter((r) => r.status === "running" && r.cloudAgentId);

  // Poll all agents concurrently
  const pollResults = await Promise.allSettled(
    activeRuns.map(async (run) => {
      const agent = await client.pollUntilDone(run.cloudAgentId!, 5000, signal);
      if (agent.status === "FINISHED") {
        completeRun(run.id, { status: "success", result: agent.summary ?? "Completed" });
        return { task: run.label, status: "success", result: agent.summary ?? "Completed" };
      } else {
        completeRun(run.id, { status: "error", error: `Agent status: ${agent.status}` });
        return { task: run.label, status: "error", result: `Agent status: ${agent.status}` };
      }
    }),
  );

  const taskResults: Array<{ task: string; status: string; result: string }> = [];
  for (const pr of pollResults) {
    if (pr.status === "fulfilled") {
      taskResults.push(pr.value);
    } else {
      taskResults.push({ task: "unknown", status: "error", result: pr.reason?.message ?? "Unknown error" });
    }
  }

  const summary = aggregateResults(fleet.tasks, taskResults);
  const anySuccess = taskResults.some((r) => r.status === "success");
  const allFailed = taskResults.every((r) => r.status !== "success");

  const fleetStatus = allFailed ? "error" : "completed";
  updateFleet(fleet.id, {
    status: fleetStatus,
    summary,
    completedAt: new Date().toISOString(),
  });

  return { success: anySuccess, summary };
}

/** Stop all agents in a fleet. */
export async function stopFleet(fleetId: string): Promise<void> {
  const client = getCloudClient();
  if (!client) {
    throw new Error("CURSOR_API_KEY is required for fleet operations");
  }

  const runs = getAgentRunsByParent(fleetId);
  const activeRuns = runs.filter((r) => r.status === "running" && r.cloudAgentId);

  await Promise.allSettled(
    activeRuns.map(async (run) => {
      try {
        await client.stopAgent(run.cloudAgentId!);
      } catch {
        // Ignore stop errors
      }
      completeRun(run.id, { status: "stopped" });
    }),
  );

  updateFleet(fleetId, {
    status: "stopped",
    completedAt: new Date().toISOString(),
  });
}

/** Aggregate results from fleet workers into a summary. */
export function aggregateResults(
  tasks: string[],
  results: Array<{ task: string; status: string; result: string }>,
): string {
  const lines = [`Fleet results (${results.length} workers):\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const icon = r.status === "success" ? "[ok]" : "[err]";
    lines.push(`${i + 1}. ${icon} ${r.task}`);
    if (r.result) {
      lines.push(`   ${r.result.slice(0, 200)}`);
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;
  lines.push(`\n${successCount}/${results.length} succeeded.`);

  return lines.join("\n");
}
