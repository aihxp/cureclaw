import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, addSuggestion, addBackgroundAgent } from "../db.js";
import { handleBackgroundCommand } from "./commands.js";
import { BackgroundRunner } from "./runner.js";
import type { CursorAgentConfig } from "../types.js";

let tmpDir: string;
let runner: BackgroundRunner;
const config: CursorAgentConfig = { cursorPath: "cursor", cwd: "/tmp" };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-bgcmd-test-"));
  initDatabase(tmpDir);
  runner = new BackgroundRunner(config);
});

afterEach(() => {
  runner.stop();
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleBackgroundCommand", () => {
  it("should return null for non-background commands", () => {
    assert.equal(handleBackgroundCommand("/help"), null);
    assert.equal(handleBackgroundCommand("/jobs"), null);
  });

  it("should show help for /background help", () => {
    const result = handleBackgroundCommand("/background help", runner);
    assert.ok(result);
    assert.ok(result.text.includes("register"));
    assert.ok(result.text.includes("suggest"));
  });

  it("should handle /background register", () => {
    const result = handleBackgroundCommand("/background register reviewer every 30m", runner);
    assert.ok(result);
    assert.ok(result.text.includes("reviewer"));
    assert.ok(result.text.includes("registered"));
  });

  it("should handle /background register missing args", () => {
    const result = handleBackgroundCommand("/background register", runner);
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("should handle /background unregister", () => {
    runner.register("temp", "every 1h");
    const result = handleBackgroundCommand("/background unregister temp", runner);
    assert.ok(result);
    assert.ok(result.text.includes("unregistered"));
  });

  it("should handle /background unregister nonexistent", () => {
    const result = handleBackgroundCommand("/background unregister nope", runner);
    assert.ok(result);
    assert.ok(result.text.includes("No background agent"));
  });

  it("should handle /background list", () => {
    runner.register("agent1", "every 1h");
    const result = handleBackgroundCommand("/background list", runner);
    assert.ok(result);
    assert.ok(result.text.includes("agent1"));
    assert.ok(result.text.includes("every 1h"));
  });

  it("should handle /background list empty", () => {
    const result = handleBackgroundCommand("/background list", runner);
    assert.ok(result);
    assert.ok(result.text.includes("No background agents"));
  });

  it("should handle /background suggest empty", () => {
    const result = handleBackgroundCommand("/background suggest", runner);
    assert.ok(result);
    assert.ok(result.text.includes("No pending suggestions"));
  });

  it("should handle /background suggest with entries", () => {
    const agent = addBackgroundAgent({
      name: "test",
      schedule: "every 1h",
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    addSuggestion({
      backgroundAgentId: agent.id,
      content: "Update the deployment script",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    const result = handleBackgroundCommand("/background suggest", runner);
    assert.ok(result);
    assert.ok(result.text.includes("Update the deployment"));
  });

  it("should handle /background status", () => {
    const result = handleBackgroundCommand("/background status", runner);
    assert.ok(result);
    assert.ok(result.text.includes("idle"));
  });
});
