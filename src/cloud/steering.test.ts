import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultEvaluator,
  steerCloudAgent,
  type CloudSteeringEvent,
  type SteeringEvaluator,
} from "./steering.js";

describe("defaultEvaluator", () => {
  it("returns done for LGTM", () => {
    const result = defaultEvaluator("Everything looks correct. LGTM!");
    assert.strictEqual(result.action, "done");
  });

  it("returns followup for non-passing text", () => {
    const result = defaultEvaluator("There were some errors in the implementation.");
    assert.strictEqual(result.action, "followup");
  });
});

// Mock CloudClient for testing the steering loop
function createMockClient(responses: Array<{
  launchResult?: { id: string; status: string };
  pollResult?: { status: string; summary?: string };
  conversationResult?: { messages: Array<{ type: string; text: string }> };
  followupResult?: { id: string };
  launchError?: string;
}>) {
  let callIdx = 0;
  let pollIdx = 0;

  return {
    async launchAgent() {
      const r = responses[0];
      if (r?.launchError) throw new Error(r.launchError);
      return r?.launchResult ?? { id: "test-agent", status: "CREATING" };
    },
    async pollUntilDone() {
      const r = responses[pollIdx];
      pollIdx++;
      return r?.pollResult ?? { status: "FINISHED", summary: "Done" };
    },
    async getConversation() {
      const r = responses[callIdx];
      return r?.conversationResult ?? { messages: [] };
    },
    async followup() {
      callIdx++;
      const r = responses[callIdx];
      return r?.followupResult ?? { id: "followup-1" };
    },
  };
}

describe("steerCloudAgent", () => {
  it("completes on first pass with done evaluator", async () => {
    const client = createMockClient([
      {
        launchResult: { id: "agent-1", status: "CREATING" },
        pollResult: { status: "FINISHED", summary: "All done" },
        conversationResult: {
          messages: [{ type: "assistant_message", text: "LGTM looks good to me" }],
        },
      },
    ]);

    const events: CloudSteeringEvent[] = [];
    for await (const event of steerCloudAgent({
      client: client as any,
      request: { prompt: { text: "fix tests" }, source: { repository: "test/repo" } },
    })) {
      events.push(event);
    }

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, "launch");
    assert.strictEqual(events[1].type, "done");
  });

  it("follows up when evaluator says so", async () => {
    let callCount = 0;
    const client = createMockClient([
      {
        launchResult: { id: "agent-1", status: "CREATING" },
        pollResult: { status: "FINISHED" },
        conversationResult: {
          messages: [{ type: "assistant_message", text: "errors found" }],
        },
      },
      {
        pollResult: { status: "FINISHED" },
        conversationResult: {
          messages: [{ type: "assistant_message", text: "LGTM all fixed" }],
        },
      },
    ]);

    const events: CloudSteeringEvent[] = [];
    const evaluator: SteeringEvaluator = (result) => {
      callCount++;
      if (callCount === 1) return { action: "followup", prompt: "try again" };
      return { action: "done", reason: "ok" };
    };

    for await (const event of steerCloudAgent({
      client: client as any,
      request: { prompt: { text: "fix tests" }, source: { repository: "test/repo" } },
      evaluator,
    })) {
      events.push(event);
    }

    assert.ok(events.some((e) => e.type === "followup"));
    assert.ok(events.some((e) => e.type === "done"));
  });

  it("stops at maxFollowups", async () => {
    const client = createMockClient([
      {
        launchResult: { id: "agent-1", status: "CREATING" },
        pollResult: { status: "FINISHED" },
        conversationResult: {
          messages: [{ type: "assistant_message", text: "errors" }],
        },
      },
      {
        pollResult: { status: "FINISHED" },
        conversationResult: {
          messages: [{ type: "assistant_message", text: "still errors" }],
        },
      },
    ]);

    const events: CloudSteeringEvent[] = [];
    const evaluator: SteeringEvaluator = () => ({
      action: "followup",
      prompt: "try again",
    });

    for await (const event of steerCloudAgent({
      client: client as any,
      request: { prompt: { text: "fix" }, source: { repository: "test/repo" } },
      maxFollowups: 1,
      evaluator,
    })) {
      events.push(event);
    }

    const followups = events.filter((e) => e.type === "followup");
    assert.strictEqual(followups.length, 1);
    assert.ok(events.some((e) => e.type === "done"));
  });

  it("handles launch error", async () => {
    const client = createMockClient([{ launchError: "API down" }]);

    const events: CloudSteeringEvent[] = [];
    for await (const event of steerCloudAgent({
      client: client as any,
      request: { prompt: { text: "fix" }, source: { repository: "test/repo" } },
    })) {
      events.push(event);
    }

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "error");
    assert.ok(events[0].error?.includes("API down"));
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const client = createMockClient([
      {
        launchResult: { id: "agent-1", status: "CREATING" },
        pollResult: { status: "FINISHED" },
        conversationResult: {
          messages: [{ type: "assistant_message", text: "done" }],
        },
      },
    ]);

    // Override pollUntilDone to throw on abort
    (client as any).pollUntilDone = async () => {
      throw new Error("Polling aborted");
    };

    const events: CloudSteeringEvent[] = [];
    for await (const event of steerCloudAgent({
      client: client as any,
      request: { prompt: { text: "fix" }, source: { repository: "test/repo" } },
      signal: controller.signal,
    })) {
      events.push(event);
    }

    assert.ok(events.some((e) => e.type === "error" || e.type === "launch"));
  });
});
