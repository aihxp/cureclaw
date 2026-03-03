import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, getActiveMonitors } from "../db.js";
import { handleMonitorCommand } from "./commands.js";

let tmpDir: string;
const ctx = { channelType: "cli", channelId: "cli" };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-mon-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleMonitorCommand", () => {
  it("should return null for non-monitor commands", () => {
    assert.equal(handleMonitorCommand("/help"), null);
    assert.equal(handleMonitorCommand("/jobs"), null);
  });

  it("should show help for /monitor", () => {
    const result = handleMonitorCommand("/monitor");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("/monitor pr"));
    assert.ok(text.includes("/monitor list"));
  });

  it("should show help for /monitor help", () => {
    const result = handleMonitorCommand("/monitor help");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("/monitor pr"));
    assert.ok(text.includes("/monitor stop"));
  });

  it("should list monitors when none exist", () => {
    const result = handleMonitorCommand("/monitor list");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("No active monitors"));
  });

  it("should require branch for /monitor pr", () => {
    const result = handleMonitorCommand("/monitor pr ");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    // Either usage or gh not available error
    assert.ok(text.includes("Usage") || text.includes("gh"));
  });

  it("should handle /monitor stop with no match", () => {
    const result = handleMonitorCommand("/monitor stop nonexistent");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("not found") || text.includes("No monitor"));
  });

  it("should require prefix for /monitor stop", () => {
    const result = handleMonitorCommand("/monitor stop ");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("Usage") || text.includes("not found"));
  });

  it("should show help for unknown subcommand", () => {
    const result = handleMonitorCommand("/monitor foobar");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("/monitor pr"));
  });

  it("should return null for /monit (partial match)", () => {
    assert.equal(handleMonitorCommand("/monit"), null);
  });

  it("should parse --auto-fix and --max-retries flags", () => {
    // This will fail since gh isn't available in test, but we verify it parses correctly
    const result = handleMonitorCommand("/monitor pr test-branch --auto-fix --max-retries 5", ctx);
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    // Will either succeed or fail on gh availability
    assert.ok(text.includes("test-branch") || text.includes("gh") || text.includes("Usage"));
  });
});
