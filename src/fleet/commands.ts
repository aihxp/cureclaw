import {
  getAllFleets,
  getActiveFleets,
  findFleetByIdPrefix,
  getAgentRunsByParent,
} from "../db.js";
import type { CommandContext, CommandResult } from "../scheduler/commands.js";
import type { CursorAgentConfig, DeliveryTarget } from "../types.js";
import { buildPlannerPrompt, parseSubtasks } from "./decompose.js";
import { launchFleet, monitorFleet, stopFleet, aggregateResults } from "./fleet.js";
import {
  startRun,
  completeRun,
  formatRunsList,
  formatRunInfo,
  getActiveAgentRuns,
  getRecentAgentRuns,
  findAgentRunByIdPrefix,
} from "./registry.js";

/**
 * Handle /fleet, /orchestrate, /runs, /run info commands.
 * Returns a CommandResult if the input matched, null otherwise.
 */
export function handleFleetCommand(
  input: string,
  ctx: CommandContext,
  config?: CursorAgentConfig,
): CommandResult | Promise<CommandResult> | null {
  const trimmed = input.trim();

  if (trimmed === "/fleet" || trimmed.startsWith("/fleet ")) {
    return handleFleet(trimmed, ctx, config);
  }

  if (trimmed === "/orchestrate" || trimmed.startsWith("/orchestrate ")) {
    return handleOrchestrate(trimmed, ctx, config);
  }

  if (trimmed === "/runs" || trimmed.startsWith("/runs ")) {
    return handleRuns(trimmed);
  }

  if (trimmed === "/run info" || trimmed.startsWith("/run info ")) {
    return handleRunInfo(trimmed);
  }

  return null;
}

// --- /fleet ---

function handleFleet(
  input: string,
  ctx: CommandContext,
  config?: CursorAgentConfig,
): CommandResult | Promise<CommandResult> {
  const args = input.slice(6).trim();

  if (!args || args === "help") {
    return {
      text: 'Fleet commands:\n\n  /fleet launch <repo> "task1" "task2" ... [--model m] [--pr]\n  /fleet status <id-prefix>\n  /fleet stop <id-prefix>\n  /fleet list',
    };
  }

  if (args === "list") {
    return handleFleetList();
  }

  if (args.startsWith("status ")) {
    return handleFleetStatus(args.slice(7).trim());
  }

  if (args.startsWith("stop ")) {
    return handleFleetStop(args.slice(5).trim());
  }

  if (args.startsWith("launch ")) {
    return handleFleetLaunch(args.slice(7).trim(), ctx, config);
  }

  return { text: 'Unknown fleet command. Type /fleet for help.' };
}

function handleFleetList(): CommandResult {
  const fleets = getAllFleets();
  if (fleets.length === 0) {
    return { text: "No fleets." };
  }

  const lines = ["Fleets:\n"];
  for (const f of fleets) {
    const icon =
      f.status === "running" ? "⟳" :
      f.status === "completed" ? "✓" :
      f.status === "error" ? "✗" : "■";
    lines.push(`  ${f.id}  [${icon} ${f.status}]  ${f.workerCount} workers  ${f.name}`);
  }
  return { text: lines.join("\n") };
}

function handleFleetStatus(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /fleet status <id-prefix>" };
  }

  const fleet = findFleetByIdPrefix(idPrefix);
  if (!fleet) {
    return { text: `No fleet found matching "${idPrefix}".` };
  }

  const runs = getAgentRunsByParent(fleet.id);
  const lines = [
    `Fleet: ${fleet.id}`,
    `Name: ${fleet.name}`,
    `Repository: ${fleet.repository}`,
    `Status: ${fleet.status}`,
    `Workers: ${fleet.workerCount}`,
    `Created: ${fleet.createdAt}`,
  ];

  if (fleet.completedAt) lines.push(`Completed: ${fleet.completedAt}`);
  if (fleet.model) lines.push(`Model: ${fleet.model}`);

  if (runs.length > 0) {
    lines.push("\nWorkers:");
    for (const run of runs) {
      const icon =
        run.status === "running" ? "⟳" :
        run.status === "success" ? "✓" :
        run.status === "error" ? "✗" : "■";
      const cloud = run.cloudAgentId ? ` (${run.cloudAgentId.slice(0, 8)})` : "";
      lines.push(`  ${run.id} [${icon} ${run.status}] ${run.label.slice(0, 50)}${cloud}`);
    }
  }

  if (fleet.summary) {
    lines.push(`\nSummary:\n${fleet.summary}`);
  }

  return { text: lines.join("\n") };
}

async function handleFleetStop(idPrefix: string): Promise<CommandResult> {
  if (!idPrefix) {
    return { text: "Usage: /fleet stop <id-prefix>" };
  }

  const fleet = findFleetByIdPrefix(idPrefix);
  if (!fleet) {
    return { text: `No fleet found matching "${idPrefix}".` };
  }

  if (fleet.status !== "running") {
    return { text: `Fleet ${fleet.id} is not running (status: ${fleet.status}).` };
  }

  try {
    await stopFleet(fleet.id);
    return { text: `Fleet ${fleet.id} stopped.` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error stopping fleet: ${msg}` };
  }
}

async function handleFleetLaunch(
  args: string,
  ctx: CommandContext,
  config?: CursorAgentConfig,
): Promise<CommandResult> {
  // Parse: <repo> "task1" "task2" ... [--model m] [--pr]
  let remaining = args;
  let model: string | undefined;
  let createPr = false;

  // Extract flags
  const modelMatch = remaining.match(/--model\s+(\S+)/);
  if (modelMatch) {
    model = modelMatch[1];
    remaining = remaining.replace(/--model\s+\S+/, "").trim();
  }

  if (remaining.includes("--pr")) {
    createPr = true;
    remaining = remaining.replace(/--pr/, "").trim();
  }

  // First token is repo URL
  const spaceIdx = remaining.indexOf(" ");
  if (spaceIdx === -1) {
    return { text: 'Usage: /fleet launch <repo> "task1" "task2" ... [--model m] [--pr]' };
  }

  const repository = remaining.slice(0, spaceIdx);
  const tasksStr = remaining.slice(spaceIdx + 1).trim();

  // Extract quoted tasks
  const tasks: string[] = [];
  const taskRegex = /"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = taskRegex.exec(tasksStr)) !== null) {
    const task = match[1].replace(/\\"/g, '"').trim();
    if (task) tasks.push(task);
  }

  if (tasks.length === 0) {
    return { text: 'No tasks specified. Enclose each task in quotes: /fleet launch <repo> "task1" "task2"' };
  }

  const delivery: DeliveryTarget =
    ctx.channelType === "cli"
      ? { kind: "store" }
      : { kind: "channel", channelType: ctx.channelType, channelId: ctx.channelId };

  try {
    const fleet = await launchFleet(
      { repository, tasks, model, createPr, delivery },
      config ?? { cursorPath: "cursor" },
    );

    // Monitor in background (don't await)
    monitorFleet(fleet, config ?? { cursorPath: "cursor" }).catch((err) => {
      console.error(`[fleet] Monitor error for ${fleet.id}:`, err.message);
    });

    return {
      text: `Fleet ${fleet.id} launched with ${tasks.length} workers.\nRepository: ${repository}${model ? `\nModel: ${model}` : ""}\n\nUse /fleet status ${fleet.id} to check progress.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error launching fleet: ${msg}` };
  }
}

// --- /orchestrate ---

function handleOrchestrate(
  input: string,
  ctx: CommandContext,
  config?: CursorAgentConfig,
): CommandResult | Promise<CommandResult> {
  const args = input.slice(12).trim();

  if (!args || args === "help") {
    return {
      text: 'Usage: /orchestrate "goal" [--cloud] [--repo <url>] [--model m] [--workers N]\n\nDecomposes a high-level goal into subtasks and dispatches workers.\nWith --cloud --repo, uses cloud fleet. Without, executes sequentially.',
    };
  }

  return handleOrchestrateLaunch(args, ctx, config);
}

async function handleOrchestrateLaunch(
  args: string,
  ctx: CommandContext,
  config?: CursorAgentConfig,
): Promise<CommandResult> {
  let remaining = args;
  let cloud = false;
  let repository: string | undefined;
  let model: string | undefined;
  let workerCount = 3;

  // Extract flags
  const repoMatch = remaining.match(/--repo\s+(\S+)/);
  if (repoMatch) {
    repository = repoMatch[1];
    remaining = remaining.replace(/--repo\s+\S+/, "").trim();
  }

  const modelMatch = remaining.match(/--model\s+(\S+)/);
  if (modelMatch) {
    model = modelMatch[1];
    remaining = remaining.replace(/--model\s+\S+/, "").trim();
  }

  const workersMatch = remaining.match(/--workers\s+(\d+)/);
  if (workersMatch) {
    workerCount = Math.max(1, Math.min(10, parseInt(workersMatch[1], 10)));
    remaining = remaining.replace(/--workers\s+\d+/, "").trim();
  }

  if (remaining.includes("--cloud")) {
    cloud = true;
    remaining = remaining.replace(/--cloud/, "").trim();
  }

  // Extract goal (quoted or unquoted)
  const goalMatch = remaining.match(/^"((?:[^"\\]|\\.)*)"$/);
  const goal = goalMatch ? goalMatch[1].replace(/\\"/g, '"') : remaining;

  if (!goal.trim()) {
    return { text: 'Usage: /orchestrate "goal" [--cloud] [--repo <url>] [--model m] [--workers N]' };
  }

  if (cloud && !repository) {
    return { text: "Cloud orchestration requires --repo <url>." };
  }

  // Step 1: Decompose the goal
  const plannerPrompt = buildPlannerPrompt(goal, workerCount);

  // For decomposition, we use the local agent to get subtasks
  // The planner prompt instructs the agent to output JSON
  const run = startRun({
    kind: "orchestrate",
    label: `Plan: ${goal.slice(0, 50)}`,
  });

  try {
    // Import Agent dynamically to avoid circular deps
    const { Agent } = await import("../agent.js");
    const planAgent = new Agent(
      config ?? { cursorPath: "cursor" },
      { useDb: false, sessionKey: `orchestrate:plan:${run.id}` },
    );

    let plannerOutput = "";
    planAgent.subscribe((event) => {
      if (event.type === "message_end" && "text" in event) {
        plannerOutput += event.text;
      }
    });

    await planAgent.prompt(plannerPrompt);
    const subtasks = parseSubtasks(plannerOutput);

    if (subtasks.length === 0) {
      completeRun(run.id, { status: "error", error: "Planner produced no valid subtasks" });
      return { text: `Orchestration failed: planner produced no valid subtasks.\n\nPlanner output:\n${plannerOutput.slice(0, 500)}` };
    }

    completeRun(run.id, {
      status: "success",
      result: `${subtasks.length} subtasks: ${subtasks.map((s) => s.name).join(", ")}`,
    });

    // Step 2: Execute subtasks
    if (cloud && repository) {
      // Cloud fleet execution
      const delivery: DeliveryTarget =
        ctx.channelType === "cli"
          ? { kind: "store" }
          : { kind: "channel", channelType: ctx.channelType, channelId: ctx.channelId };

      const fleet = await launchFleet(
        {
          repository,
          tasks: subtasks.map((s) => s.task),
          model,
          delivery,
        },
        config ?? { cursorPath: "cursor" },
      );

      // Monitor in background
      monitorFleet(fleet, config ?? { cursorPath: "cursor" }).catch((err) => {
        console.error(`[orchestrate] Monitor error for fleet ${fleet.id}:`, err.message);
      });

      const subtaskList = subtasks.map((s, i) => `  ${i + 1}. ${s.name}: ${s.task.slice(0, 60)}`).join("\n");
      return {
        text: `Orchestration started for: "${goal.slice(0, 60)}"\n\nSubtasks:\n${subtaskList}\n\nFleet ${fleet.id} launched with ${subtasks.length} workers.\nUse /fleet status ${fleet.id} to check progress.`,
      };
    } else {
      // Local sequential execution
      const subtaskList = subtasks.map((s, i) => `  ${i + 1}. ${s.name}: ${s.task.slice(0, 60)}`).join("\n");
      const results: Array<{ task: string; status: string; result: string }> = [];

      for (const subtask of subtasks) {
        const workerRun = startRun({
          kind: "orchestrate",
          parentId: run.id,
          label: subtask.task,
        });

        try {
          const workerAgent = new Agent(
            config ?? { cursorPath: "cursor" },
            { useDb: false, sessionKey: `orchestrate:worker:${workerRun.id}` },
          );

          let workerOutput = "";
          workerAgent.subscribe((event) => {
            if (event.type === "message_end" && "text" in event) {
              workerOutput += event.text;
            }
          });

          await workerAgent.prompt(subtask.task);
          completeRun(workerRun.id, { status: "success", result: workerOutput.slice(0, 500) });
          results.push({ task: subtask.name, status: "success", result: workerOutput.slice(0, 200) });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          completeRun(workerRun.id, { status: "error", error: msg });
          results.push({ task: subtask.name, status: "error", result: msg });
        }
      }

      const summary = aggregateResults(
        subtasks.map((s) => s.name),
        results,
      );

      return {
        text: `Orchestration complete for: "${goal.slice(0, 60)}"\n\nSubtasks:\n${subtaskList}\n\n${summary}`,
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    completeRun(run.id, { status: "error", error: msg });
    return { text: `Orchestration error: ${msg}` };
  }
}

// --- /runs ---

function handleRuns(input: string): CommandResult {
  const args = input.slice(5).trim();
  const activeOnly = args.includes("--active");

  const runs = activeOnly ? getActiveAgentRuns() : getRecentAgentRuns(20);
  return { text: formatRunsList(runs) };
}

// --- /run info ---

function handleRunInfo(input: string): CommandResult {
  const idPrefix = input.slice(9).trim();
  if (!idPrefix) {
    return { text: "Usage: /run info <id-prefix>" };
  }

  const run = findAgentRunByIdPrefix(idPrefix);
  if (!run) {
    return { text: `No run found matching "${idPrefix}".` };
  }

  return { text: formatRunInfo(run) };
}
