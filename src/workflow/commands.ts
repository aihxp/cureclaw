import type { CommandContext, CommandResult } from "../scheduler/commands.js";
import type { CursorAgentConfig, DeliveryTarget, WorkflowStep } from "../types.js";
import {
  addWorkflow,
  getAllWorkflows,
  findWorkflowByIdPrefix,
  removeWorkflow,
  updateWorkflow,
} from "../db.js";
import { runWorkflow, formatWorkflowInfo, formatWorkflowList } from "./engine.js";

/**
 * Handle /workflow commands.
 * Returns CommandResult or Promise<CommandResult> if matched, null otherwise.
 */
export function handleWorkflowCommand(
  input: string,
  ctx: CommandContext,
  config?: CursorAgentConfig,
): CommandResult | Promise<CommandResult> | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/workflow")) return null;

  const rest = trimmed.slice(9).trim();

  if (rest === "" || rest === "help") {
    return {
      text: [
        "Workflow commands:",
        "  /workflow create <name> <json-steps>   Create a workflow from JSON step definitions",
        "  /workflow run <id-prefix>              Execute a workflow",
        "  /workflow status <id-prefix>           Show workflow status",
        "  /workflow list                         List all workflows",
        "  /workflow stop <id-prefix>             Stop a running workflow",
        "  /workflow remove <id-prefix>           Delete a workflow",
        "",
        "Step kinds: prompt, cloud, shell, condition",
        'Example: /workflow create deploy \'[{"name":"build","kind":"shell","config":{"command":"npm run build"}}]\'',
      ].join("\n"),
    };
  }

  if (rest === "list") {
    const workflows = getAllWorkflows();
    return { text: formatWorkflowList(workflows) };
  }

  if (rest === "create" || rest.startsWith("create ")) {
    return handleCreate(rest.slice(6).trim(), ctx);
  }

  if (rest.startsWith("run ")) {
    return handleRun(rest.slice(4).trim(), config);
  }

  if (rest.startsWith("status ")) {
    return handleStatus(rest.slice(7).trim());
  }

  if (rest.startsWith("stop ")) {
    return handleStop(rest.slice(5).trim());
  }

  if (rest.startsWith("remove ")) {
    return handleRemoveWorkflow(rest.slice(7).trim());
  }

  return { text: "Unknown workflow subcommand. Type /workflow help for usage." };
}

function handleCreate(args: string, ctx: CommandContext): CommandResult {
  // Parse: <name> <json-steps>
  const spaceIdx = args.indexOf(" ");
  if (spaceIdx === -1) {
    return { text: "Usage: /workflow create <name> <json-steps>" };
  }

  const name = args.slice(0, spaceIdx);
  const jsonStr = args.slice(spaceIdx + 1).trim();

  let steps: WorkflowStep[];
  try {
    steps = JSON.parse(jsonStr) as WorkflowStep[];
    if (!Array.isArray(steps) || steps.length === 0) {
      return { text: "Steps must be a non-empty JSON array." };
    }
    // Validate each step has name and kind
    for (const step of steps) {
      if (!step.name || !step.kind) {
        return { text: `Each step must have "name" and "kind" fields.` };
      }
    }
  } catch {
    return { text: "Invalid JSON. Steps must be a valid JSON array." };
  }

  const delivery: DeliveryTarget =
    ctx.channelType === "cli"
      ? { kind: "store" }
      : { kind: "channel", channelType: ctx.channelType, channelId: ctx.channelId };

  const workflow = addWorkflow({
    name,
    description: "",
    steps,
    status: "pending",
    currentStep: 0,
    results: {},
    delivery,
    createdAt: new Date().toISOString(),
  });

  return { text: `Workflow "${workflow.name}" (${workflow.id}) created with ${steps.length} steps.` };
}

async function handleRun(idPrefix: string, config?: CursorAgentConfig): Promise<CommandResult> {
  if (!idPrefix) {
    return { text: "Usage: /workflow run <id-prefix>" };
  }

  if (!config) {
    return { text: "Workflow execution requires agent configuration." };
  }

  const workflow = findWorkflowByIdPrefix(idPrefix);
  if (!workflow) {
    return { text: `No workflow found matching "${idPrefix}".` };
  }

  if (workflow.status === "running") {
    return { text: `Workflow "${workflow.name}" is already running.` };
  }

  // Reset if previously completed/errored
  if (workflow.status !== "pending") {
    updateWorkflow(workflow.id, { status: "pending", currentStep: 0, results: {} });
  }

  const refreshed = findWorkflowByIdPrefix(idPrefix)!;

  try {
    const { success, results } = await runWorkflow(refreshed, config);
    const stepResults = Object.entries(results)
      .map(([name, result]) => `  ${name}: ${result.slice(0, 60)}${result.length > 60 ? "..." : ""}`)
      .join("\n");

    return {
      text: `Workflow "${workflow.name}" ${success ? "completed" : "failed"}.\n\nResults:\n${stepResults}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Workflow error: ${msg}` };
  }
}

function handleStatus(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /workflow status <id-prefix>" };
  }

  const workflow = findWorkflowByIdPrefix(idPrefix);
  if (!workflow) {
    return { text: `No workflow found matching "${idPrefix}".` };
  }

  return { text: formatWorkflowInfo(workflow) };
}

function handleStop(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /workflow stop <id-prefix>" };
  }

  const workflow = findWorkflowByIdPrefix(idPrefix);
  if (!workflow) {
    return { text: `No workflow found matching "${idPrefix}".` };
  }

  if (workflow.status !== "running") {
    return { text: `Workflow "${workflow.name}" is not running (status: ${workflow.status}).` };
  }

  updateWorkflow(workflow.id, { status: "stopped", completedAt: new Date().toISOString() });
  return { text: `Workflow "${workflow.name}" (${workflow.id}) stopped.` };
}

function handleRemoveWorkflow(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /workflow remove <id-prefix>" };
  }

  const workflow = findWorkflowByIdPrefix(idPrefix);
  if (!workflow) {
    return { text: `No workflow found matching "${idPrefix}".` };
  }

  removeWorkflow(workflow.id);
  return { text: `Workflow "${workflow.name}" (${workflow.id}) removed.` };
}
