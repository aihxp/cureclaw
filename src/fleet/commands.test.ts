import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { initDatabase, closeDatabase, addFleet } from "../db.js";
import { startRun, completeRun } from "./registry.js";
import { handleFleetCommand } from "./commands.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-fleet-cmd-test-${Date.now()}`);
const ctx = { channelType: "cli", channelId: "cli" };

describe("handleFleetCommand", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-fleet commands", () => {
    assert.strictEqual(handleFleetCommand("/schedule test", ctx), null);
    assert.strictEqual(handleFleetCommand("/cloud launch", ctx), null);
    assert.strictEqual(handleFleetCommand("hello", ctx), null);
  });

  it("/fleet shows help", () => {
    const result = handleFleetCommand("/fleet", ctx);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("Fleet commands"));
  });

  it("/fleet help shows help", () => {
    const result = handleFleetCommand("/fleet help", ctx);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("Fleet commands"));
  });

  it("/fleet list shows empty", () => {
    const result = handleFleetCommand("/fleet list", ctx);
    assert.ok(result);
    assert.strictEqual((result as { text: string }).text, "No fleets.");
  });

  it("/fleet list shows fleets", () => {
    addFleet({
      name: "test fleet",
      repository: "https://github.com/test/repo",
      tasks: ["task 1"],
      model: null,
      status: "running",
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
      workerCount: 1,
    });

    const result = handleFleetCommand("/fleet list", ctx);
    assert.ok(result);
    const text = (result as { text: string }).text;
    assert.ok(text.includes("test fleet"));
    assert.ok(text.includes("1 workers"));
  });

  it("/fleet status shows fleet details", () => {
    const fleet = addFleet({
      name: "status test",
      repository: "https://github.com/test/repo",
      tasks: ["task 1", "task 2"],
      model: "sonnet-4",
      status: "running",
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
      workerCount: 2,
    });

    startRun({ kind: "fleet", parentId: fleet.id, label: "task 1", cloudAgentId: "cloud-abc" });

    const result = handleFleetCommand(`/fleet status ${fleet.id}`, ctx);
    assert.ok(result);
    const text = (result as { text: string }).text;
    assert.ok(text.includes(fleet.id));
    assert.ok(text.includes("status test"));
    assert.ok(text.includes("sonnet-4"));
    assert.ok(text.includes("task 1"));
  });

  it("/fleet status for unknown ID", () => {
    const result = handleFleetCommand("/fleet status zzz", ctx);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes('No fleet found'));
  });

  it("/fleet stop for non-running fleet", () => {
    const fleet = addFleet({
      name: "done fleet",
      repository: "https://github.com/test/repo",
      tasks: ["task"],
      model: null,
      status: "completed",
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
      workerCount: 1,
    });

    const resultPromise = handleFleetCommand(`/fleet stop ${fleet.id}`, ctx);
    assert.ok(resultPromise);
    // This is async
    (resultPromise as Promise<{ text: string }>).then((result) => {
      assert.ok(result.text.includes("not running"));
    });
  });

  it("/fleet launch without tasks shows error", async () => {
    const result = handleFleetCommand("/fleet launch https://github.com/test/repo", ctx);
    assert.ok(result);
    const resolved = await result;
    assert.ok((resolved as { text: string }).text.includes("Usage"));
  });

  it("/fleet launch without quotes shows error", async () => {
    const result = handleFleetCommand("/fleet launch https://github.com/test/repo task1", ctx);
    assert.ok(result);
    const resolved = await result;
    assert.ok((resolved as { text: string }).text.includes("No tasks specified"));
  });

  // /fleet launch with valid args would require CURSOR_API_KEY; skip live test
  it("/fleet launch without API key shows error", async () => {
    const original = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    try {
      const result = handleFleetCommand('/fleet launch https://github.com/test/repo "task1"', ctx);
      assert.ok(result);
      const resolved = await result;
      assert.ok((resolved as { text: string }).text.includes("CURSOR_API_KEY"));
    } finally {
      if (original) process.env.CURSOR_API_KEY = original;
    }
  });
});

describe("/orchestrate command", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-orchestrate commands", () => {
    assert.strictEqual(handleFleetCommand("/schedule test", ctx), null);
  });

  it("/orchestrate shows help", () => {
    const result = handleFleetCommand("/orchestrate", ctx);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("Usage"));
  });

  it("/orchestrate help shows help", () => {
    const result = handleFleetCommand("/orchestrate help", ctx);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("Usage"));
  });

  it("/orchestrate with cloud but no repo shows error", async () => {
    const result = handleFleetCommand('/orchestrate "goal" --cloud', ctx);
    assert.ok(result);
    const resolved = await result;
    assert.ok((resolved as { text: string }).text.includes("requires --repo"));
  });
});

describe("/runs command", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-runs commands", () => {
    assert.strictEqual(handleFleetCommand("/schedule test", ctx), null);
  });

  it("/runs shows empty message", () => {
    const result = handleFleetCommand("/runs", ctx);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("No agent runs"));
  });

  it("/runs shows recent runs", () => {
    startRun({ kind: "prompt", label: "test prompt" });

    const result = handleFleetCommand("/runs", ctx);
    assert.ok(result);
    const text = (result as { text: string }).text;
    assert.ok(text.includes("test prompt"));
    assert.ok(text.includes("prompt"));
  });

  it("/runs --active shows only running", () => {
    const r1 = startRun({ kind: "prompt", label: "active run" });
    const r2 = startRun({ kind: "prompt", label: "done run" });
    completeRun(r2.id, { status: "success" });

    const result = handleFleetCommand("/runs --active", ctx);
    assert.ok(result);
    const text = (result as { text: string }).text;
    assert.ok(text.includes("active run"));
    assert.ok(!text.includes("done run"));
  });
});

describe("/run info command", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("/run info without ID shows usage", () => {
    const result = handleFleetCommand("/run info", ctx);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("Usage"));
  });

  it("/run info shows run details", () => {
    const run = startRun({ kind: "fleet", label: "my task", cloudAgentId: "cloud-123" });

    const result = handleFleetCommand(`/run info ${run.id}`, ctx);
    assert.ok(result);
    const text = (result as { text: string }).text;
    assert.ok(text.includes(run.id));
    assert.ok(text.includes("fleet"));
    assert.ok(text.includes("my task"));
    assert.ok(text.includes("cloud-123"));
  });

  it("/run info for unknown ID shows error", () => {
    const result = handleFleetCommand("/run info zzz", ctx);
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("No run found"));
  });
});
