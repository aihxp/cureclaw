import type { CloudClient } from "./client.js";
import type { LaunchAgentRequest } from "./types.js";
import type { WebhookServer, WebhookEvent } from "../webhook/server.js";
import { isReflectionPass } from "../reflection.js";

export type SteeringDecision =
  | { action: "done"; reason: string }
  | { action: "followup"; prompt: string };

export type SteeringEvaluator = (result: string) => SteeringDecision;

/** Default evaluator: done if LGTM/pass, followup asking for fixes otherwise */
export function defaultEvaluator(result: string): SteeringDecision {
  if (isReflectionPass(result)) {
    return { action: "done", reason: "Agent reported success" };
  }
  return {
    action: "followup",
    prompt: "The previous attempt had issues. Please review and fix any errors.",
  };
}

export interface CloudSteeringEvent {
  type: "launch" | "followup" | "done" | "error";
  agentId: string;
  followupNumber?: number;
  result?: string;
  error?: string;
}

/**
 * Launch a cloud agent and autonomously steer it via follow-ups.
 * Uses webhook for completion detection when available, falls back to polling.
 */
export async function* steerCloudAgent(opts: {
  client: CloudClient;
  request: LaunchAgentRequest;
  maxFollowups?: number;
  evaluator?: SteeringEvaluator;
  webhookServer?: WebhookServer;
  signal?: AbortSignal;
}): AsyncGenerator<CloudSteeringEvent> {
  const {
    client,
    request,
    maxFollowups = 5,
    evaluator = defaultEvaluator,
    webhookServer,
    signal,
  } = opts;

  // Attach webhook if available
  const launchRequest = { ...request };
  if (webhookServer) {
    launchRequest.webhook = {
      url: webhookServer.webhookUrl,
      secret: webhookServer.webhookSecret,
    };
  }

  // Launch the agent
  let agentId: string;
  try {
    const launched = await client.launchAgent(launchRequest);
    agentId = launched.id;
  } catch (err) {
    yield {
      type: "error",
      agentId: "",
      error: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  yield { type: "launch", agentId };

  // Wait for initial completion
  let result = await waitForCompletion(client, agentId, webhookServer, signal);
  if (signal?.aborted) {
    yield { type: "error", agentId, error: "Aborted" };
    return;
  }

  if (result.error) {
    yield { type: "error", agentId, error: result.error };
    return;
  }

  // Steering loop
  let followupCount = 0;
  while (followupCount < maxFollowups) {
    if (signal?.aborted) {
      yield { type: "error", agentId, error: "Aborted" };
      return;
    }

    const decision = evaluator(result.text);
    if (decision.action === "done") {
      yield { type: "done", agentId, result: result.text };
      return;
    }

    followupCount++;
    yield {
      type: "followup",
      agentId,
      followupNumber: followupCount,
      result: decision.prompt,
    };

    try {
      await client.followup(agentId, { text: decision.prompt });
    } catch (err) {
      yield {
        type: "error",
        agentId,
        error: `Follow-up failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      return;
    }

    result = await waitForCompletion(client, agentId, webhookServer, signal);
    if (signal?.aborted) {
      yield { type: "error", agentId, error: "Aborted" };
      return;
    }
    if (result.error) {
      yield { type: "error", agentId, error: result.error };
      return;
    }
  }

  // Max follow-ups reached
  yield {
    type: "done",
    agentId,
    result: result.text,
  };
}

async function waitForCompletion(
  client: CloudClient,
  agentId: string,
  webhookServer?: WebhookServer,
  signal?: AbortSignal,
): Promise<{ text: string; error?: string }> {
  // If webhook server is available, wait for webhook event
  if (webhookServer) {
    const event = await waitForWebhookEvent(webhookServer, agentId, signal);
    if (event) {
      if (event.status === "FINISHED") {
        return { text: event.summary ?? "" };
      }
      return { text: "", error: `Agent ${event.status}: ${event.summary ?? "unknown"}` };
    }
    // Fallback to polling if webhook didn't fire
  }

  // Poll until done
  try {
    const agent = await client.pollUntilDone(agentId, 5000, signal);
    if (agent.status === "FINISHED") {
      const conv = await client.getConversation(agentId);
      const assistantMsgs = conv.messages
        .filter((m) => m.type === "assistant_message")
        .map((m) => m.text);
      return { text: assistantMsgs[assistantMsgs.length - 1] ?? agent.summary ?? "" };
    }
    return { text: "", error: `Agent ${agent.status}: ${agent.summary ?? "unknown error"}` };
  } catch (err) {
    return { text: "", error: err instanceof Error ? err.message : String(err) };
  }
}

function waitForWebhookEvent(
  webhookServer: WebhookServer,
  agentId: string,
  signal?: AbortSignal,
  timeoutMs = 600_000,
): Promise<WebhookEvent | null> {
  return new Promise((resolve) => {
    let unsub: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      unsub?.();
      clearTimeout(timer);
    };

    unsub = webhookServer.subscribe((event) => {
      if (event.agentId === agentId) {
        cleanup();
        resolve(event);
      }
    });

    timer = setTimeout(() => {
      cleanup();
      resolve(null); // Timeout, fall back to polling
    }, timeoutMs);

    if (signal) {
      signal.addEventListener("abort", () => {
        cleanup();
        resolve(null);
      }, { once: true });
    }
  });
}
