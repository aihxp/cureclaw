import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { initDatabase, closeDatabase, addTrigger, getTrigger } from "../db.js";
import { findMatchingTriggers } from "./engine.js";
import type { Trigger } from "../types.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-engine-test-${Date.now()}`);

describe("findMatchingTriggers", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty array when no triggers exist", () => {
    const result = findMatchingTriggers({ kind: "webhook", name: "test" });
    assert.strictEqual(result.length, 0);
  });

  it("matches webhook trigger by name", () => {
    addTrigger({
      name: "deploy-hook",
      condition: { kind: "webhook", name: "deploy-hook" },
      prompt: "review deploy",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const result = findMatchingTriggers({ kind: "webhook", name: "deploy-hook" });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "deploy-hook");
  });

  it("does not match webhook with different name", () => {
    addTrigger({
      name: "deploy-hook",
      condition: { kind: "webhook", name: "deploy-hook" },
      prompt: "review deploy",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const result = findMatchingTriggers({ kind: "webhook", name: "other" });
    assert.strictEqual(result.length, 0);
  });

  it("does not match disabled trigger", () => {
    addTrigger({
      name: "disabled-hook",
      condition: { kind: "webhook", name: "disabled-hook" },
      prompt: "test",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: false,
      createdAt: new Date().toISOString(),
    });

    const result = findMatchingTriggers({ kind: "webhook", name: "disabled-hook" });
    assert.strictEqual(result.length, 0);
  });

  it("matches job_complete by jobId prefix and status", () => {
    addTrigger({
      name: "on-test-fail",
      condition: { kind: "job_complete", jobId: "abc123", onStatus: "error" },
      prompt: "fix tests",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const match = findMatchingTriggers({
      kind: "job_complete",
      jobId: "abc12345",
      status: "error",
    });
    assert.strictEqual(match.length, 1);

    const noMatch = findMatchingTriggers({
      kind: "job_complete",
      jobId: "abc12345",
      status: "success",
    });
    assert.strictEqual(noMatch.length, 0);
  });

  it("matches job_complete with onStatus any", () => {
    addTrigger({
      name: "on-any-complete",
      condition: { kind: "job_complete", jobId: "abc", onStatus: "any" },
      prompt: "notify",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const result = findMatchingTriggers({
      kind: "job_complete",
      jobId: "abc12345",
      status: "success",
    });
    assert.strictEqual(result.length, 1);
  });

  it("matches cloud_complete by status", () => {
    addTrigger({
      name: "on-cloud-done",
      condition: { kind: "cloud_complete", onStatus: "FINISHED" },
      prompt: "review PR",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const match = findMatchingTriggers({
      kind: "cloud_complete",
      agentId: "agent-1",
      status: "FINISHED",
    });
    assert.strictEqual(match.length, 1);

    const noMatch = findMatchingTriggers({
      kind: "cloud_complete",
      agentId: "agent-1",
      status: "ERROR",
    });
    assert.strictEqual(noMatch.length, 0);
  });

  it("matches cloud_complete with onStatus any", () => {
    addTrigger({
      name: "on-cloud-any",
      condition: { kind: "cloud_complete", onStatus: "any" },
      prompt: "log it",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const result = findMatchingTriggers({
      kind: "cloud_complete",
      agentId: "agent-1",
      status: "ERROR",
    });
    assert.strictEqual(result.length, 1);
  });

  it("matches multiple triggers for same event", () => {
    addTrigger({
      name: "hook-a",
      condition: { kind: "webhook", name: "deploy" },
      prompt: "a",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    addTrigger({
      name: "hook-b",
      condition: { kind: "webhook", name: "deploy" },
      prompt: "b",
      contextProviders: [],
      delivery: { kind: "store" },
      cloud: false,
      reflect: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const result = findMatchingTriggers({ kind: "webhook", name: "deploy" });
    assert.strictEqual(result.length, 2);
  });

  it("addTrigger persists and getTrigger retrieves", () => {
    const trigger = addTrigger({
      name: "persist-test",
      condition: { kind: "webhook", name: "persist-test" },
      prompt: "hello",
      contextProviders: [{ name: "diff", kind: "git_diff" }],
      delivery: { kind: "store" },
      cloud: true,
      reflect: true,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const retrieved = getTrigger(trigger.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.name, "persist-test");
    assert.strictEqual(retrieved.cloud, true);
    assert.strictEqual(retrieved.reflect, true);
    assert.strictEqual(retrieved.contextProviders.length, 1);
    assert.strictEqual(retrieved.contextProviders[0].kind, "git_diff");
    assert.strictEqual(retrieved.fireCount, 0);
    assert.strictEqual(retrieved.lastFiredAt, null);
  });
});
