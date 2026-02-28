import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleSchedulerCommand } from "./commands.js";
import { initDatabase, closeDatabase, getAllJobs, removeJob } from "../db.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-test-${Date.now()}`);

describe("scheduler commands", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  const ctx = { channelType: "telegram", channelId: "12345" };

  describe("/schedule", () => {
    it("creates a job with every schedule", () => {
      const result = handleSchedulerCommand('/schedule "test prompt" every 1h', ctx);
      assert.ok(result);
      assert.ok(result.text.includes("Job"));
      assert.ok(result.text.includes("created"));

      const jobs = getAllJobs();
      assert.strictEqual(jobs.length, 1);
      assert.strictEqual(jobs[0].prompt, "test prompt");
      assert.deepStrictEqual(jobs[0].schedule, { kind: "every", everyMs: 3_600_000 });
      assert.deepStrictEqual(jobs[0].delivery, { kind: "channel", channelType: "telegram", channelId: "12345" });
    });

    it("creates a job with cron schedule", () => {
      const result = handleSchedulerCommand('/schedule "daily check" cron 0 9 * * 1-5', ctx);
      assert.ok(result);
      assert.ok(result.text.includes("created"));
    });

    it("creates a cloud job with --cloud flag", () => {
      const result = handleSchedulerCommand('/schedule "cloud task" every 30m --cloud', ctx);
      assert.ok(result);
      const jobs = getAllJobs();
      assert.strictEqual(jobs[0].cloud, true);
    });

    it("returns usage on invalid format", () => {
      const result = handleSchedulerCommand("/schedule bad format", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("Usage"));
    });

    it("returns error for past at schedule", () => {
      const result = handleSchedulerCommand('/schedule "past" at 2020-01-01T00:00:00Z', ctx);
      assert.ok(result);
      assert.ok(result.text.includes("past"));
    });

    it("sets delivery to store for CLI context", () => {
      const cliCtx = { channelType: "cli", channelId: "cli" };
      handleSchedulerCommand('/schedule "test" every 1h', cliCtx);
      const jobs = getAllJobs();
      assert.deepStrictEqual(jobs[0].delivery, { kind: "store" });
    });
  });

  describe("/jobs", () => {
    it("shows no jobs message when empty", () => {
      const result = handleSchedulerCommand("/jobs", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("No scheduled jobs"));
    });

    it("lists created jobs", () => {
      handleSchedulerCommand('/schedule "test" every 1h', ctx);
      const result = handleSchedulerCommand("/jobs", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("test"));
      assert.ok(result.text.includes("every"));
    });
  });

  describe("/cancel", () => {
    it("removes a job by ID prefix", () => {
      handleSchedulerCommand('/schedule "test" every 1h', ctx);
      const jobs = getAllJobs();
      const id = jobs[0].id;

      const result = handleSchedulerCommand(`/cancel ${id.slice(0, 4)}`, ctx);
      assert.ok(result);
      assert.ok(result.text.includes("removed"));
      assert.strictEqual(getAllJobs().length, 0);
    });

    it("reports not found for bad prefix", () => {
      const result = handleSchedulerCommand("/cancel zzzzz", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("No job found"));
    });
  });

  describe("non-scheduler commands", () => {
    it("returns null for unknown commands", () => {
      const result = handleSchedulerCommand("/help", ctx);
      assert.strictEqual(result, null);
    });

    it("returns null for regular text", () => {
      const result = handleSchedulerCommand("hello", ctx);
      assert.strictEqual(result, null);
    });
  });
});
