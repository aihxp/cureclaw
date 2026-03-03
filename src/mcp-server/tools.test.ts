import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, addMemory, addJob, addBackgroundAgent, addWorkflow } from "../db.js";
import { handleToolCall, toolDefinitions } from "./tools.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-mcp-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("toolDefinitions", () => {
  it("should have 12 tool definitions", () => {
    assert.equal(toolDefinitions.length, 12);
  });

  it("should have names starting with cureclaw_", () => {
    for (const tool of toolDefinitions) {
      assert.ok(tool.name.startsWith("cureclaw_"));
    }
  });
});

describe("handleToolCall", () => {
  it("should handle cureclaw_status", () => {
    const result = handleToolCall("cureclaw_status", {});
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("CureClaw"));
    assert.ok(result.content[0].text.includes("Sessions:"));
  });

  it("should handle cureclaw_sessions list (empty)", () => {
    const result = handleToolCall("cureclaw_sessions", { action: "list" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No sessions"));
  });

  it("should handle cureclaw_sessions history with missing key", () => {
    const result = handleToolCall("cureclaw_sessions", { action: "history" });
    assert.ok(result.isError);
  });

  it("should handle cureclaw_sessions history", () => {
    const result = handleToolCall("cureclaw_sessions", { action: "history", sessionKey: "/tmp/test" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No history"));
  });

  it("should handle cureclaw_jobs (empty)", () => {
    const result = handleToolCall("cureclaw_jobs", { action: "list" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No scheduled jobs"));
  });

  it("should handle cureclaw_memory list (empty)", () => {
    const result = handleToolCall("cureclaw_memory", { action: "list" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No memories"));
  });

  it("should handle cureclaw_memory add", () => {
    const result = handleToolCall("cureclaw_memory", { action: "add", key: "test", content: "value" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("added"));
  });

  it("should handle cureclaw_memory search", () => {
    const now = new Date().toISOString();
    addMemory({ key: "api-key", content: "use TOKEN", tags: [], source: "user", createdAt: now, updatedAt: now });
    const result = handleToolCall("cureclaw_memory", { action: "search", query: "api" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("api-key"));
  });

  it("should handle cureclaw_memory search with missing query", () => {
    const result = handleToolCall("cureclaw_memory", { action: "search" });
    assert.ok(result.isError);
  });

  it("should handle cureclaw_agents list (empty)", () => {
    const result = handleToolCall("cureclaw_agents", { action: "list" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No background agents"));
  });

  it("should handle cureclaw_agents suggestions (empty)", () => {
    const result = handleToolCall("cureclaw_agents", { action: "suggestions" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No pending suggestions"));
  });

  it("should handle cureclaw_workflows (empty)", () => {
    const result = handleToolCall("cureclaw_workflows", { action: "list" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No workflows"));
  });

  it("should handle cureclaw_runs active (empty)", () => {
    const result = handleToolCall("cureclaw_runs", { action: "active" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No active runs"));
  });

  it("should handle cureclaw_runs recent (empty)", () => {
    const result = handleToolCall("cureclaw_runs", { action: "recent" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No agent runs"));
  });

  it("should handle cureclaw_triggers (empty)", () => {
    const result = handleToolCall("cureclaw_triggers", { action: "list" });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("No triggers"));
  });

  it("should handle unknown tool", () => {
    const result = handleToolCall("nonexistent", {});
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes("Unknown tool"));
  });
});
