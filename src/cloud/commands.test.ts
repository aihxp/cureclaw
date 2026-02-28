import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { handleCloudCommand } from "./commands.js";

const ctx = { channelType: "cli", channelId: "cli" };

describe("cloud commands", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.CURSOR_API_KEY;
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.CURSOR_API_KEY = savedKey;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
  });

  it("returns null for non-cloud commands", () => {
    assert.strictEqual(handleCloudCommand("/help", ctx), null);
    assert.strictEqual(handleCloudCommand("/jobs", ctx), null);
    assert.strictEqual(handleCloudCommand("hello", ctx), null);
  });

  it("returns help text for /cloud", async () => {
    const result = await handleCloudCommand("/cloud", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Cloud commands"));
  });

  it("returns help text for /cloud help", async () => {
    const result = await handleCloudCommand("/cloud help", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Cloud commands"));
  });

  it("returns no-API-key error for /cloud models without key", async () => {
    delete process.env.CURSOR_API_KEY;
    const result = await handleCloudCommand("/cloud models", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("CURSOR_API_KEY"));
  });

  it("returns no-API-key error for /cloud list without key", async () => {
    delete process.env.CURSOR_API_KEY;
    const result = await handleCloudCommand("/cloud list", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("CURSOR_API_KEY"));
  });

  it("returns no-API-key error for /cloud status without key", async () => {
    delete process.env.CURSOR_API_KEY;
    const result = await handleCloudCommand("/cloud status abc", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("CURSOR_API_KEY"));
  });

  it("returns no-API-key error for /cloud stop without key", async () => {
    delete process.env.CURSOR_API_KEY;
    const result = await handleCloudCommand("/cloud stop abc", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("CURSOR_API_KEY"));
  });

  it("returns no-API-key error for /cloud conversation without key", async () => {
    delete process.env.CURSOR_API_KEY;
    const result = await handleCloudCommand("/cloud conversation abc", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("CURSOR_API_KEY"));
  });

  it("returns usage for /cloud launch with bad format", async () => {
    delete process.env.CURSOR_API_KEY;
    const result = await handleCloudCommand("/cloud launch bad format", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("returns no-API-key for /cloud launch with valid format", async () => {
    delete process.env.CURSOR_API_KEY;
    const result = await handleCloudCommand(
      '/cloud launch "hello" https://github.com/user/repo',
      ctx,
    );
    assert.ok(result);
    assert.ok(result.text.includes("CURSOR_API_KEY"));
  });

  it("returns usage for /cloud status without id", async () => {
    delete process.env.CURSOR_API_KEY;
    const result = await handleCloudCommand("/cloud status ", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("returns error for unknown subcommand", async () => {
    const result = await handleCloudCommand("/cloud foobar", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Unknown cloud subcommand"));
  });
});
