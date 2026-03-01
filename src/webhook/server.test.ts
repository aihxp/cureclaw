import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { WebhookServer, type WebhookEvent, type TriggerWebhookEvent } from "./server.js";

let server: WebhookServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

function sign(payload: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function postWebhook(
  port: number,
  body: string,
  signature?: string,
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature) headers["x-webhook-signature"] = signature;

  const res = await fetch(`http://localhost:${port}/webhook`, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

describe("WebhookServer", () => {
  it("starts and stops", async () => {
    server = new WebhookServer({ port: 0 });
    const port = await server.start();
    assert.ok(port > 0);
    await server.stop();
    server = null;
  });

  it("returns 404 for non-webhook paths", async () => {
    server = new WebhookServer({ port: 0 });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/other`);
    assert.strictEqual(res.status, 404);
  });

  it("returns 404 for GET requests", async () => {
    server = new WebhookServer({ port: 0 });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/webhook`);
    assert.strictEqual(res.status, 404);
  });

  it("rejects missing signature", async () => {
    server = new WebhookServer({ port: 0, secret: "test-secret" });
    const port = await server.start();
    const res = await postWebhook(port, '{"event":"statusChange"}');
    assert.strictEqual(res.status, 401);
  });

  it("rejects invalid signature", async () => {
    server = new WebhookServer({ port: 0, secret: "test-secret" });
    const port = await server.start();
    const body = '{"event":"statusChange"}';
    const res = await postWebhook(port, body, "sha256=invalid");
    assert.strictEqual(res.status, 401);
  });

  it("accepts valid HMAC and dispatches event", async () => {
    const secret = "test-secret";
    server = new WebhookServer({ port: 0, secret });
    const port = await server.start();

    const received: WebhookEvent[] = [];
    server.subscribe((event) => received.push(event));

    const payload: WebhookEvent = {
      event: "statusChange",
      agentId: "agent-123",
      status: "FINISHED",
      summary: "Done",
      timestamp: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const sig = sign(body, secret);

    const res = await postWebhook(port, body, sig);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].agentId, "agent-123");
    assert.strictEqual(received[0].status, "FINISHED");
  });

  it("returns 400 for malformed JSON", async () => {
    const secret = "test-secret";
    server = new WebhookServer({ port: 0, secret });
    const port = await server.start();

    const body = "not-json";
    const sig = sign(body, secret);

    const res = await postWebhook(port, body, sig);
    assert.strictEqual(res.status, 400);
  });

  it("unsubscribe removes handler", async () => {
    const secret = "test-secret";
    server = new WebhookServer({ port: 0, secret });
    const port = await server.start();

    const received: WebhookEvent[] = [];
    const unsub = server.subscribe((event) => received.push(event));
    unsub();

    const payload: WebhookEvent = {
      event: "statusChange",
      agentId: "agent-123",
      status: "FINISHED",
      timestamp: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const sig = sign(body, secret);
    await postWebhook(port, body, sig);

    assert.strictEqual(received.length, 0);
  });

  // Trigger endpoint tests

  it("POST /trigger/:name dispatches trigger event", async () => {
    server = new WebhookServer({ port: 0 });
    const port = await server.start();

    const received: TriggerWebhookEvent[] = [];
    server.subscribeTrigger((event) => received.push(event));

    const res = await fetch(`http://localhost:${port}/trigger/deploy-hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main" }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].name, "deploy-hook");
    assert.deepStrictEqual(received[0].payload, { branch: "main" });
  });

  it("POST /trigger/:name works with empty body", async () => {
    server = new WebhookServer({ port: 0 });
    const port = await server.start();

    const received: TriggerWebhookEvent[] = [];
    server.subscribeTrigger((event) => received.push(event));

    const res = await fetch(`http://localhost:${port}/trigger/simple-hook`, {
      method: "POST",
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].name, "simple-hook");
    assert.deepStrictEqual(received[0].payload, {});
  });

  it("POST /trigger/:name rejects invalid name", async () => {
    server = new WebhookServer({ port: 0 });
    const port = await server.start();

    const res = await fetch(`http://localhost:${port}/trigger/INVALID_NAME`, {
      method: "POST",
    });
    assert.strictEqual(res.status, 404);
  });

  it("POST /trigger/:name rejects bad JSON body", async () => {
    server = new WebhookServer({ port: 0 });
    const port = await server.start();

    const res = await fetch(`http://localhost:${port}/trigger/test-hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    assert.strictEqual(res.status, 400);
  });

  it("POST /trigger/:name checks trigger secret when configured", async () => {
    server = new WebhookServer({ port: 0, triggerSecret: "my-secret" });
    const port = await server.start();

    // No secret — rejected
    const res1 = await fetch(`http://localhost:${port}/trigger/test-hook`, {
      method: "POST",
    });
    assert.strictEqual(res1.status, 401);

    // Wrong secret — rejected
    const res2 = await fetch(`http://localhost:${port}/trigger/test-hook`, {
      method: "POST",
      headers: { "x-trigger-secret": "wrong" },
    });
    assert.strictEqual(res2.status, 401);

    // Correct secret — accepted
    const res3 = await fetch(`http://localhost:${port}/trigger/test-hook`, {
      method: "POST",
      headers: { "x-trigger-secret": "my-secret" },
    });
    assert.strictEqual(res3.status, 200);
  });

  it("subscribeTrigger unsubscribe works", async () => {
    server = new WebhookServer({ port: 0 });
    const port = await server.start();

    const received: TriggerWebhookEvent[] = [];
    const unsub = server.subscribeTrigger((event) => received.push(event));
    unsub();

    await fetch(`http://localhost:${port}/trigger/test-hook`, { method: "POST" });
    assert.strictEqual(received.length, 0);
  });
});
