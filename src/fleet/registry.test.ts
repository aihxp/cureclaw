import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { initDatabase, closeDatabase } from "../db.js";
import {
  startRun,
  completeRun,
  formatRunsList,
  formatRunInfo,
  getAgentRun,
  getAgentRunsByParent,
  getActiveAgentRuns,
  getRecentAgentRuns,
  findAgentRunByIdPrefix,
} from "./registry.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-registry-test-${Date.now()}`);

describe("agent run registry", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("startRun creates a run with generated ID", () => {
    const run = startRun({ kind: "fleet", label: "test task" });
    assert.ok(run.id);
    assert.strictEqual(run.kind, "fleet");
    assert.strictEqual(run.label, "test task");
    assert.strictEqual(run.status, "running");
    assert.strictEqual(run.parentId, null);
    assert.strictEqual(run.cloudAgentId, null);
    assert.ok(run.startedAt);
  });

  it("startRun with parentId and cloudAgentId", () => {
    const run = startRun({
      kind: "fleet",
      parentId: "fleet-1",
      label: "worker task",
      cloudAgentId: "cloud-abc",
    });
    assert.strictEqual(run.parentId, "fleet-1");
    assert.strictEqual(run.cloudAgentId, "cloud-abc");
  });

  it("completeRun updates status, result, and completedAt", () => {
    const run = startRun({ kind: "prompt", label: "single prompt" });
    completeRun(run.id, { status: "success", result: "done" });

    const updated = getAgentRun(run.id);
    assert.ok(updated);
    assert.strictEqual(updated.status, "success");
    assert.strictEqual(updated.result, "done");
    assert.ok(updated.completedAt);
  });

  it("completeRun with error", () => {
    const run = startRun({ kind: "trigger", label: "webhook trigger" });
    completeRun(run.id, { status: "error", error: "timeout" });

    const updated = getAgentRun(run.id);
    assert.ok(updated);
    assert.strictEqual(updated.status, "error");
    assert.strictEqual(updated.error, "timeout");
  });

  it("getAgentRunsByParent groups runs by parent", () => {
    const r1 = startRun({ kind: "fleet", parentId: "f1", label: "task 1" });
    const r2 = startRun({ kind: "fleet", parentId: "f1", label: "task 2" });
    startRun({ kind: "fleet", parentId: "f2", label: "task 3" });

    const children = getAgentRunsByParent("f1");
    assert.strictEqual(children.length, 2);
    const ids = children.map((r) => r.id);
    assert.ok(ids.includes(r1.id));
    assert.ok(ids.includes(r2.id));
  });

  it("getActiveAgentRuns filters to running only", () => {
    const r1 = startRun({ kind: "prompt", label: "active" });
    const r2 = startRun({ kind: "prompt", label: "also active" });
    completeRun(r2.id, { status: "success" });

    const active = getActiveAgentRuns();
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].id, r1.id);
  });

  it("getRecentAgentRuns returns runs", () => {
    startRun({ kind: "prompt", label: "first" });
    startRun({ kind: "prompt", label: "second" });

    const recent = getRecentAgentRuns(10);
    assert.strictEqual(recent.length, 2);
    const labels = recent.map((r) => r.label);
    assert.ok(labels.includes("first"));
    assert.ok(labels.includes("second"));
  });

  it("findAgentRunByIdPrefix finds by prefix", () => {
    const run = startRun({ kind: "job", label: "scheduled job" });
    const found = findAgentRunByIdPrefix(run.id.slice(0, 4));
    assert.ok(found);
    assert.strictEqual(found.id, run.id);
  });

  it("findAgentRunByIdPrefix returns undefined for no match", () => {
    const found = findAgentRunByIdPrefix("zzz");
    assert.strictEqual(found, undefined);
  });

  it("formatRunsList shows empty message", () => {
    const result = formatRunsList([]);
    assert.strictEqual(result, "No agent runs.");
  });

  it("formatRunsList formats runs", () => {
    const run = startRun({ kind: "fleet", parentId: "f1", label: "fix auth" });
    const runs = getRecentAgentRuns();
    const result = formatRunsList(runs);
    assert.ok(result.includes(run.id));
    assert.ok(result.includes("fleet"));
    assert.ok(result.includes("fix auth"));
  });

  it("formatRunInfo shows full details", () => {
    const run = startRun({
      kind: "fleet",
      parentId: "f1",
      label: "fix auth bugs",
      cloudAgentId: "cloud-xyz-123",
    });
    completeRun(run.id, { status: "success", result: "Fixed 3 bugs" });
    const updated = getAgentRun(run.id)!;

    const info = formatRunInfo(updated);
    assert.ok(info.includes(run.id));
    assert.ok(info.includes("fleet"));
    assert.ok(info.includes("success"));
    assert.ok(info.includes("fix auth bugs"));
    assert.ok(info.includes("f1"));
    assert.ok(info.includes("cloud-xyz-123"));
    assert.ok(info.includes("Fixed 3 bugs"));
  });
});
