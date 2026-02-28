import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { CloudClient, getCloudClient } from "./client.js";

// Helper to extract fetch call args from the mock
function getCallArgs(mockFetch: ReturnType<typeof mock.fn>, callIdx = 0) {
  const args = mockFetch.mock.calls[callIdx].arguments as unknown[];
  return {
    url: args[0] as string,
    opts: args[1] as { method: string; headers: Record<string, string>; body?: string },
  };
}

describe("CloudClient", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = mock.fn();
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends Basic auth header with base64(key:)", async () => {
    const client = new CloudClient("test-api-key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ models: [] }),
    }));

    await client.listModels();

    const { opts } = getCallArgs(mockFetch);
    assert.strictEqual(opts.headers.Authorization, `Basic ${btoa("test-api-key:")}`);
  });

  it("builds correct URL for listAgents", async () => {
    const client = new CloudClient("key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ agents: [] }),
    }));

    await client.listAgents({ limit: 10, cursor: "abc" });

    const { url } = getCallArgs(mockFetch);
    assert.ok(url.includes("/v1/agents?"));
    assert.ok(url.includes("limit=10"));
    assert.ok(url.includes("cursor=abc"));
  });

  it("builds correct URL for getAgent", async () => {
    const client = new CloudClient("key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "abc", name: "test", status: "RUNNING" }),
    }));

    await client.getAgent("abc-123");

    const { url } = getCallArgs(mockFetch);
    assert.ok(url.endsWith("/v1/agents/abc-123"));
  });

  it("builds correct URL for getConversation", async () => {
    const client = new CloudClient("key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ messages: [] }),
    }));

    await client.getConversation("abc-123");

    const { url } = getCallArgs(mockFetch);
    assert.ok(url.endsWith("/v1/agents/abc-123/conversation"));
  });

  it("builds correct URL for stopAgent", async () => {
    const client = new CloudClient("key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "abc-123" }),
    }));

    await client.stopAgent("abc-123");

    const { url, opts } = getCallArgs(mockFetch);
    assert.ok(url.endsWith("/v1/agents/abc-123/stop"));
    assert.strictEqual(opts.method, "POST");
  });

  it("builds correct URL for deleteAgent", async () => {
    const client = new CloudClient("key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "abc-123" }),
    }));

    await client.deleteAgent("abc-123");

    const { opts } = getCallArgs(mockFetch);
    assert.strictEqual(opts.method, "DELETE");
  });

  it("sends POST body for launchAgent", async () => {
    const client = new CloudClient("key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        id: "new",
        name: "test",
        status: "CREATING",
        source: { repository: "https://github.com/user/repo" },
        createdAt: "2026-01-01",
      }),
    }));

    await client.launchAgent({
      prompt: { text: "hello" },
      source: { repository: "https://github.com/user/repo" },
    });

    const { opts } = getCallArgs(mockFetch);
    assert.strictEqual(opts.method, "POST");
    const body = JSON.parse(opts.body!);
    assert.strictEqual(body.prompt.text, "hello");
    assert.strictEqual(body.source.repository, "https://github.com/user/repo");
  });

  it("throws on non-2xx response", async () => {
    const client = new CloudClient("key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ message: "Invalid API key" }),
    }));

    await assert.rejects(
      () => client.listModels(),
      (err: Error & { apiError?: { status: number; message: string } }) => {
        assert.ok(err.message.includes("401"));
        assert.strictEqual(err.apiError?.status, 401);
        assert.strictEqual(err.apiError?.message, "Invalid API key");
        return true;
      },
    );
  });

  it("handles non-JSON error body gracefully", async () => {
    const client = new CloudClient("key");
    mockFetch.mock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => { throw new Error("not json"); },
    }));

    await assert.rejects(
      () => client.listModels(),
      (err: Error) => {
        assert.ok(err.message.includes("500"));
        return true;
      },
    );
  });
});

describe("getCloudClient", () => {
  it("returns null when CURSOR_API_KEY is not set", () => {
    const saved = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    try {
      assert.strictEqual(getCloudClient(), null);
    } finally {
      if (saved) process.env.CURSOR_API_KEY = saved;
    }
  });

  it("returns CloudClient when CURSOR_API_KEY is set", () => {
    const saved = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "test-key";
    try {
      const client = getCloudClient();
      assert.ok(client instanceof CloudClient);
    } finally {
      if (saved) {
        process.env.CURSOR_API_KEY = saved;
      } else {
        delete process.env.CURSOR_API_KEY;
      }
    }
  });
});
