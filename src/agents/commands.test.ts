import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleAgentCommand } from "./commands.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-agents-cmd-test-${Date.now()}`);

describe("handleAgentCommand", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-agent commands", () => {
    assert.strictEqual(handleAgentCommand("/mcp list", TEST_DIR), null);
  });

  it("shows help for /agent", () => {
    const result = handleAgentCommand("/agent", TEST_DIR);
    assert.ok(result);
    const text = (result as { text: string }).text;
    assert.ok(text.includes("Agent commands:"));
    assert.ok(text.includes("/agent run"));
    assert.ok(text.includes("/agent steer"));
    assert.ok(text.includes("/agent kill"));
  });

  it("creates a subagent", () => {
    const result = handleAgentCommand('/agent create reviewer --readonly --description "Code review"', TEST_DIR);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("created"));

    const filePath = path.join(TEST_DIR, ".cursor", "agents", "reviewer.md");
    assert.ok(fs.existsSync(filePath));
  });

  it("lists subagents", () => {
    handleAgentCommand('/agent create helper --description "Helper agent"', TEST_DIR);
    const result = handleAgentCommand("/agents", TEST_DIR);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("helper"));
  });

  it("rejects invalid agent name", () => {
    const result = handleAgentCommand("/agent create -bad", TEST_DIR);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("Invalid"));
  });

  it("shows no active subagents", () => {
    const result = handleAgentCommand("/agent list --active", TEST_DIR);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("No active subagents"));
  });

  it("returns error for run with unknown agent", async () => {
    const result = await handleAgentCommand("/agent run nonexistent", TEST_DIR, undefined, {
      cursorPath: "cursor",
    });
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("not found"));
  });

  it("returns error for steer with no active agents", () => {
    const result = handleAgentCommand('/agent steer test "hello"', TEST_DIR);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("No active subagent"));
  });

  it("returns error for kill with no active agents", () => {
    const result = handleAgentCommand("/agent kill test", TEST_DIR);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("No active subagent"));
  });

  it("shows usage for run with no name", async () => {
    const result = await handleAgentCommand("/agent run ", TEST_DIR, undefined, {
      cursorPath: "cursor",
    });
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("Usage"));
  });
});
