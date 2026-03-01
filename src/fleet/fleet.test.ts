import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { initDatabase, closeDatabase, getFleet, addFleet, getAgentRunsByParent } from "../db.js";
import { aggregateResults } from "./fleet.js";
import { startRun, completeRun } from "./registry.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-fleet-test-${Date.now()}`);

describe("aggregateResults", () => {
  it("formats success results", () => {
    const summary = aggregateResults(
      ["task a", "task b"],
      [
        { task: "task a", status: "success", result: "Done" },
        { task: "task b", status: "success", result: "Also done" },
      ],
    );
    assert.ok(summary.includes("[ok] task a"));
    assert.ok(summary.includes("[ok] task b"));
    assert.ok(summary.includes("2/2 succeeded"));
  });

  it("formats mixed results", () => {
    const summary = aggregateResults(
      ["task a", "task b"],
      [
        { task: "task a", status: "success", result: "Done" },
        { task: "task b", status: "error", result: "Failed" },
      ],
    );
    assert.ok(summary.includes("[ok] task a"));
    assert.ok(summary.includes("[err] task b"));
    assert.ok(summary.includes("1/2 succeeded"));
  });

  it("formats all-error results", () => {
    const summary = aggregateResults(
      ["task a"],
      [{ task: "task a", status: "error", result: "Timeout" }],
    );
    assert.ok(summary.includes("[err] task a"));
    assert.ok(summary.includes("0/1 succeeded"));
  });

  it("truncates long results", () => {
    const longResult = "x".repeat(300);
    const summary = aggregateResults(
      ["task"],
      [{ task: "task", status: "success", result: longResult }],
    );
    // Result line should be truncated to 200 chars
    assert.ok(!summary.includes(longResult));
    assert.ok(summary.includes("x".repeat(200)));
  });

  it("includes worker count header", () => {
    const summary = aggregateResults(
      ["a", "b", "c"],
      [
        { task: "a", status: "success", result: "ok" },
        { task: "b", status: "success", result: "ok" },
        { task: "c", status: "error", result: "fail" },
      ],
    );
    assert.ok(summary.includes("3 workers"));
  });
});

describe("fleet DB integration", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates fleet and tracks worker runs", () => {
    const fleet = addFleet({
      name: "test fleet",
      repository: "https://github.com/test/repo",
      tasks: ["task 1", "task 2"],
      model: null,
      status: "running",
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
      workerCount: 2,
    });

    assert.ok(fleet.id);
    assert.strictEqual(fleet.workerCount, 2);

    const r1 = startRun({ kind: "fleet", parentId: fleet.id, label: "task 1", cloudAgentId: "cloud-1" });
    const r2 = startRun({ kind: "fleet", parentId: fleet.id, label: "task 2", cloudAgentId: "cloud-2" });

    completeRun(r1.id, { status: "success", result: "done" });
    completeRun(r2.id, { status: "error", error: "timeout" });

    const runs = getAgentRunsByParent(fleet.id);
    assert.strictEqual(runs.length, 2);
    assert.ok(runs.some((r) => r.status === "success"));
    assert.ok(runs.some((r) => r.status === "error"));
  });

  it("fleet getFleet retrieves with parsed tasks", () => {
    const fleet = addFleet({
      name: "test",
      repository: "https://github.com/test/repo",
      tasks: ["a", "b"],
      model: "sonnet-4",
      status: "running",
      delivery: { kind: "channel", channelType: "telegram", channelId: "123" },
      createdAt: new Date().toISOString(),
      workerCount: 2,
    });

    const retrieved = getFleet(fleet.id);
    assert.ok(retrieved);
    assert.deepStrictEqual(retrieved.tasks, ["a", "b"]);
    assert.strictEqual(retrieved.model, "sonnet-4");
    assert.strictEqual(retrieved.delivery.kind, "channel");
    if (retrieved.delivery.kind === "channel") {
      assert.strictEqual(retrieved.delivery.channelType, "telegram");
    }
  });

  it("fleet with store delivery", () => {
    const fleet = addFleet({
      name: "store fleet",
      repository: "https://github.com/test/repo",
      tasks: ["x"],
      model: null,
      status: "running",
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
      workerCount: 1,
    });

    const retrieved = getFleet(fleet.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.delivery.kind, "store");
  });
});
