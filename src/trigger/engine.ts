import { Agent } from "../agent.js";
import { getTriggersByCondition, updateTrigger } from "../db.js";
import { deliver } from "../scheduler/delivery.js";
import type { AgentEvent, CursorAgentConfig, Trigger } from "../types.js";
import { gatherContext, interpolateContext, interpolateEvent } from "./context.js";

const MAX_DEPTH = 5;
const activeDepth = new Map<string, number>();

export type TriggerEvent =
  | { kind: "webhook"; name: string; payload?: Record<string, unknown> }
  | { kind: "job_complete"; jobId: string; status: "success" | "error"; result?: string }
  | { kind: "cloud_complete"; agentId: string; status: string; summary?: string };

/**
 * Find all enabled triggers that match the given event.
 */
export function findMatchingTriggers(event: TriggerEvent): Trigger[] {
  const triggers = getTriggersByCondition(event.kind);

  return triggers.filter((t) => {
    switch (event.kind) {
      case "webhook":
        return t.condition.kind === "webhook" && t.condition.name === event.name;
      case "job_complete":
        return (
          t.condition.kind === "job_complete" &&
          event.jobId.startsWith(t.condition.jobId) &&
          (t.condition.onStatus === "any" || t.condition.onStatus === event.status)
        );
      case "cloud_complete":
        return (
          t.condition.kind === "cloud_complete" &&
          (t.condition.onStatus === "any" || t.condition.onStatus === event.status)
        );
      default:
        return false;
    }
  });
}

/**
 * Build event variables for template interpolation.
 */
function buildEventVars(event: TriggerEvent): Record<string, string> {
  const vars: Record<string, string> = {};

  switch (event.kind) {
    case "webhook":
      vars.payload = event.payload ? JSON.stringify(event.payload) : "";
      break;
    case "job_complete":
      vars.status = event.status;
      vars.result = event.result ?? "";
      vars.jobId = event.jobId;
      break;
    case "cloud_complete":
      vars.status = event.status;
      vars.summary = event.summary ?? "";
      vars.agentId = event.agentId;
      break;
  }

  return vars;
}

/**
 * Fire a single trigger: gather context, interpolate prompt, execute agent, update DB.
 */
export async function fireTrigger(
  trigger: Trigger,
  event: TriggerEvent,
  config: CursorAgentConfig,
): Promise<{ success: boolean; result: string }> {
  const cwd = config.cwd || process.cwd();

  // Gather context
  const context = trigger.contextProviders.length > 0
    ? await gatherContext(trigger.contextProviders, cwd)
    : new Map<string, string>();

  // Interpolate prompt
  let prompt = trigger.prompt;
  prompt = interpolateContext(prompt, context);
  prompt = interpolateEvent(prompt, buildEventVars(event));

  // Execute via Agent (same pattern as Scheduler.executeJobLocal)
  const agentConfig: CursorAgentConfig = {
    ...config,
    cloud: trigger.cloud || config.cloud,
    workstation: trigger.workstation,
    mode: trigger.mode,
  };

  const agent = new Agent(agentConfig, {
    useDb: true,
    sessionKey: `trigger:${trigger.id}`,
    reflect: trigger.reflect,
  });

  let result = "";
  let error = "";

  const unsubscribe = agent.subscribe((ev: AgentEvent) => {
    if (ev.type === "message_end" && ev.text) {
      result += (result ? "\n\n" : "") + ev.text;
    }
    if (ev.type === "error") {
      error = ev.message;
    }
  });

  try {
    await agent.prompt(prompt);
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    unsubscribe();
  }

  const success = !error;
  const now = new Date().toISOString();

  // Update trigger status
  updateTrigger(trigger.id, {
    lastFiredAt: now,
    lastStatus: success ? "success" : "error",
    lastError: error || null,
    fireCount: trigger.fireCount + 1,
  });

  // Deliver result
  const deliveryText = success
    ? `Trigger "${trigger.name}" fired:\n\n${result || "(no output)"}`
    : `Trigger "${trigger.name}" failed:\n\n${error}`;

  try {
    await deliver(trigger.delivery, deliveryText);
  } catch {
    // Delivery errors logged but not fatal
  }

  console.log(`[trigger] "${trigger.name}" ${success ? "completed" : "failed"}`);
  return { success, result: success ? result : error };
}

/**
 * Process an event: find matching triggers, fire them all.
 * Max depth prevents infinite cycles (trigger A → job → trigger B → job → trigger A...).
 */
export async function processEvent(
  event: TriggerEvent,
  config: CursorAgentConfig,
): Promise<void> {
  const matching = findMatchingTriggers(event);
  if (matching.length === 0) return;

  for (const trigger of matching) {
    const depth = activeDepth.get(trigger.id) ?? 0;
    if (depth >= MAX_DEPTH) {
      console.warn(`[trigger] Cycle detected for "${trigger.name}" (depth ${depth}), skipping`);
      continue;
    }

    activeDepth.set(trigger.id, depth + 1);
    try {
      await fireTrigger(trigger, event, config);
    } catch (err) {
      console.error(`[trigger] Error firing "${trigger.name}":`, err);
    } finally {
      const current = activeDepth.get(trigger.id) ?? 1;
      if (current <= 1) {
        activeDepth.delete(trigger.id);
      } else {
        activeDepth.set(trigger.id, current - 1);
      }
    }
  }
}
