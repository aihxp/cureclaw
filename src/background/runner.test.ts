import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, addSuggestion, getPendingSuggestions } from "../db.js";
import { BackgroundRunner } from "./runner.js";
import type { CursorAgentConfig } from "../types.js";

let tmpDir: string;
const config: CursorAgentConfig = {
  cursorPath: "cursor",
  cwd: "/tmp",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-bg-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("BackgroundRunner", () => {
  it("should register a background agent", () => {
    const runner = new BackgroundRunner(config);
    const agent = runner.register("reviewer", "every 30m");
    assert.equal(agent.name, "reviewer");
    assert.equal(agent.schedule, "every 30m");
    assert.equal(agent.enabled, true);
  });

  it("should reject duplicate registration", () => {
    const runner = new BackgroundRunner(config);
    runner.register("reviewer", "every 30m");
    assert.throws(() => runner.register("reviewer", "every 1h"), /already registered/);
  });

  it("should reject invalid schedule", () => {
    const runner = new BackgroundRunner(config);
    assert.throws(() => runner.register("bad", "once"), /Invalid schedule/);
  });

  it("should unregister a background agent", () => {
    const runner = new BackgroundRunner(config);
    runner.register("temp", "every 1h");
    assert.ok(runner.unregister("temp"));
  });

  it("should return false when unregistering nonexistent", () => {
    const runner = new BackgroundRunner(config);
    assert.equal(runner.unregister("nope"), false);
  });

  it("should get pending suggestions", () => {
    const runner = new BackgroundRunner(config);
    const agent = runner.register("test-agent", "every 1h");

    addSuggestion({
      backgroundAgentId: agent.id,
      content: "Test suggestion",
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    const suggestions = runner.getSuggestions();
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].content, "Test suggestion");
  });

  it("should accept and dismiss suggestions", () => {
    const runner = new BackgroundRunner(config);
    const agent = runner.register("accept-test", "every 1h");
    const s = addSuggestion({
      backgroundAgentId: agent.id,
      content: "Do something",
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    runner.acceptSuggestion(s.id);
    assert.equal(getPendingSuggestions().length, 0);
  });

  it("should start and stop", () => {
    const runner = new BackgroundRunner(config);
    assert.equal(runner.status, "idle");
    runner.start();
    assert.equal(runner.status, "running");
    runner.stop();
    assert.equal(runner.status, "stopped");
  });
});
