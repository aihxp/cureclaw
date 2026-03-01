import { execSync } from "node:child_process";
import type { Workflow, WorkflowStep, CursorAgentConfig } from "../types.js";
import { getWorkflow, updateWorkflow } from "../db.js";

/**
 * Interpolate step config with previous results.
 * Replaces {{step.NAME}} and {{step.NAME.status}} patterns.
 */
export function interpolateStepConfig(
  template: string,
  results: Record<string, string>,
): string {
  return template.replace(/\{\{step\.([^.}]+)(\.status)?\}\}/g, (match, name: string, statusSuffix: string) => {
    if (statusSuffix) {
      return name in results ? "success" : "error";
    }
    return name in results ? results[name] : match;
  });
}

/**
 * Evaluate a condition expression against results.
 * Uses simple pattern matching rather than eval for safety.
 */
export function evaluateCondition(
  condition: string,
  results: Record<string, string>,
): boolean {
  // Interpolate step references first
  let interpolated = interpolateStepConfig(condition, results);

  // Simple evaluations:
  // "true" / "false"
  if (interpolated.trim().toLowerCase() === "true") return true;
  if (interpolated.trim().toLowerCase() === "false") return false;

  // "success" (truthy) / "error" (falsy)
  if (interpolated.trim().toLowerCase() === "success") return true;
  if (interpolated.trim().toLowerCase() === "error") return false;

  // "X == Y" / "X != Y"
  const eqMatch = interpolated.match(/^(.+?)\s*==\s*(.+)$/);
  if (eqMatch) {
    return eqMatch[1].trim() === eqMatch[2].trim();
  }
  const neqMatch = interpolated.match(/^(.+?)\s*!=\s*(.+)$/);
  if (neqMatch) {
    return neqMatch[1].trim() !== neqMatch[2].trim();
  }

  // Default: truthy if non-empty
  return interpolated.trim().length > 0;
}

/**
 * Execute a single workflow step.
 */
export async function executeStep(
  step: WorkflowStep,
  context: Record<string, string>,
  config: CursorAgentConfig,
): Promise<{ success: boolean; result: string }> {
  switch (step.kind) {
    case "prompt": {
      const prompt = step.config.prompt
        ? interpolateStepConfig(step.config.prompt, context)
        : "";
      if (!prompt) return { success: false, result: "No prompt specified" };

      const { Agent } = await import("../agent.js");
      const agent = new Agent(
        { ...config, mode: "agent" },
        { useDb: false },
      );

      let resultText = "";
      const unsubscribe = agent.subscribe((event) => {
        if (event.type === "message_end" && "text" in event) {
          resultText += event.text;
        }
      });

      try {
        await agent.prompt(prompt, { reflect: step.config.reflect });
        return { success: true, result: resultText };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, result: msg };
      } finally {
        unsubscribe();
      }
    }

    case "cloud": {
      const prompt = step.config.prompt
        ? interpolateStepConfig(step.config.prompt, context)
        : "";
      if (!prompt) return { success: false, result: "No prompt specified" };

      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) return { success: false, result: "CURSOR_API_KEY not set" };

      try {
        const { CloudClient } = await import("../cloud/client.js");
        const client = new CloudClient(apiKey);
        const agentResult = await client.launchAgent({
          prompt: { text: prompt },
          source: { repository: step.config.repository },
          model: step.config.model,
        });
        return { success: true, result: JSON.stringify(agentResult) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, result: msg };
      }
    }

    case "shell": {
      const command = step.config.command
        ? interpolateStepConfig(step.config.command, context)
        : "";
      if (!command) return { success: false, result: "No command specified" };

      try {
        const output = execSync(command, {
          cwd: config.cwd,
          timeout: 60_000,
          encoding: "utf-8",
        });
        return { success: true, result: output.trim() };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, result: msg };
      }
    }

    case "condition": {
      const condition = step.config.condition
        ? interpolateStepConfig(step.config.condition, context)
        : "";
      const isTrue = evaluateCondition(condition, context);
      return { success: true, result: isTrue ? "true" : "false" };
    }

    default:
      return { success: false, result: `Unknown step kind: ${step.kind}` };
  }
}

/**
 * Execute a workflow from its current step.
 */
export async function runWorkflow(
  workflow: Workflow,
  config: CursorAgentConfig,
): Promise<{ success: boolean; results: Record<string, string> }> {
  const results = { ...workflow.results };
  let currentStep = workflow.currentStep;

  updateWorkflow(workflow.id, { status: "running" });

  while (currentStep < workflow.steps.length) {
    const step = workflow.steps[currentStep];

    // Handle condition steps (may jump to a different step)
    if (step.kind === "condition") {
      const condition = step.config.condition
        ? interpolateStepConfig(step.config.condition, results)
        : "";
      const isTrue = evaluateCondition(condition, results);
      results[step.name] = isTrue ? "true" : "false";

      const targetName = isTrue ? step.config.onTrue : step.config.onFalse;
      if (targetName) {
        const targetIdx = workflow.steps.findIndex((s) => s.name === targetName);
        if (targetIdx !== -1) {
          currentStep = targetIdx;
          updateWorkflow(workflow.id, { currentStep, results });
          continue;
        }
      }

      currentStep++;
      updateWorkflow(workflow.id, { currentStep, results });
      continue;
    }

    // Execute non-condition step
    const { success, result } = await executeStep(step, results, config);
    results[step.name] = result;

    currentStep++;
    updateWorkflow(workflow.id, { currentStep, results });

    if (!success) {
      updateWorkflow(workflow.id, {
        status: "error",
        completedAt: new Date().toISOString(),
      });
      return { success: false, results };
    }
  }

  updateWorkflow(workflow.id, {
    status: "completed",
    completedAt: new Date().toISOString(),
  });

  return { success: true, results };
}

/** Format workflow status for display. */
export function formatWorkflowInfo(workflow: Workflow): string {
  const lines = [
    `ID: ${workflow.id}`,
    `Name: ${workflow.name}`,
    `Description: ${workflow.description || "(none)"}`,
    `Status: ${workflow.status}`,
    `Steps: ${workflow.steps.length}`,
    `Current step: ${workflow.currentStep}/${workflow.steps.length}`,
    `Created: ${workflow.createdAt}`,
  ];

  if (workflow.completedAt) {
    lines.push(`Completed: ${workflow.completedAt}`);
  }

  if (workflow.steps.length > 0) {
    lines.push("\nSteps:");
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const marker = i < workflow.currentStep ? "[done]" : i === workflow.currentStep ? "[next]" : "[    ]";
      const result = workflow.results[step.name];
      const resultPreview = result ? ` → ${result.slice(0, 40)}${result.length > 40 ? "..." : ""}` : "";
      lines.push(`  ${marker} ${i + 1}. ${step.name} (${step.kind})${resultPreview}`);
    }
  }

  return lines.join("\n");
}

/** Format workflow list for display. */
export function formatWorkflowList(workflows: Workflow[]): string {
  if (workflows.length === 0) return "No workflows.";

  const lines = ["Workflows:\n"];
  for (const w of workflows) {
    const progress = `${w.currentStep}/${w.steps.length}`;
    lines.push(`  ${w.id}  [${w.status}]  ${w.name}  (${progress} steps)`);
  }
  return lines.join("\n");
}
