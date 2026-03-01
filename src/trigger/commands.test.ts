import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { initDatabase, closeDatabase, getAllTriggers, findTriggerByIdPrefix } from "../db.js";
import { handleTriggerCommand } from "./commands.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-trigger-cmd-test-${Date.now()}`);
const ctx = { channelType: "telegram", channelId: "12345" };

describe("handleTriggerCommand", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-trigger input", () => {
    assert.strictEqual(handleTriggerCommand("/schedule test", ctx), null);
    assert.strictEqual(handleTriggerCommand("hello", ctx), null);
  });

  it("shows help for bare /trigger", () => {
    const result = handleTriggerCommand("/trigger", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("shows help for /trigger help", () => {
    const result = handleTriggerCommand("/trigger help", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  describe("/trigger add webhook", () => {
    it("creates a webhook trigger", () => {
      const result = handleTriggerCommand(
        '/trigger add webhook deploy-hook "Review the deploy"',
        ctx,
      );
      assert.ok(result);
      assert.ok(result.text.includes("created"));
      assert.ok(result.text.includes("deploy-hook"));

      const triggers = getAllTriggers();
      assert.strictEqual(triggers.length, 1);
      assert.strictEqual(triggers[0].name, "deploy-hook");
      assert.strictEqual(triggers[0].condition.kind, "webhook");
      assert.strictEqual(triggers[0].prompt, "Review the deploy");
    });

    it("creates a webhook trigger with --cloud flag", () => {
      handleTriggerCommand(
        '/trigger add webhook test "prompt" --cloud',
        ctx,
      );
      const triggers = getAllTriggers();
      assert.strictEqual(triggers[0].cloud, true);
    });

    it("creates a webhook trigger with --reflect flag", () => {
      handleTriggerCommand(
        '/trigger add webhook test "prompt" --reflect',
        ctx,
      );
      const triggers = getAllTriggers();
      assert.strictEqual(triggers[0].reflect, true);
    });

    it("creates a webhook trigger with --context", () => {
      handleTriggerCommand(
        '/trigger add webhook test "check diff" --context git_diff,git_log:20',
        ctx,
      );
      const triggers = getAllTriggers();
      assert.strictEqual(triggers[0].contextProviders.length, 2);
      assert.strictEqual(triggers[0].contextProviders[0].kind, "git_diff");
      assert.strictEqual(triggers[0].contextProviders[1].kind, "git_log");
      assert.strictEqual(triggers[0].contextProviders[1].arg, "20");
    });

    it("creates a webhook trigger with --workstation and --mode", () => {
      handleTriggerCommand(
        '/trigger add webhook test "prompt" --workstation dev --mode plan',
        ctx,
      );
      const triggers = getAllTriggers();
      assert.strictEqual(triggers[0].workstation, "dev");
      assert.strictEqual(triggers[0].mode, "plan");
    });

    it("shows usage for invalid webhook format", () => {
      const result = handleTriggerCommand("/trigger add webhook", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("Usage"));
    });

    it("sets delivery from channel context", () => {
      handleTriggerCommand(
        '/trigger add webhook test "prompt"',
        ctx,
      );
      const triggers = getAllTriggers();
      assert.deepStrictEqual(triggers[0].delivery, {
        kind: "channel",
        channelType: "telegram",
        channelId: "12345",
      });
    });

    it("sets store delivery for CLI context", () => {
      handleTriggerCommand(
        '/trigger add webhook test "prompt"',
        { channelType: "cli", channelId: "cli" },
      );
      const triggers = getAllTriggers();
      assert.deepStrictEqual(triggers[0].delivery, { kind: "store" });
    });
  });

  describe("/trigger add job-chain", () => {
    it("creates a job chain trigger", () => {
      const result = handleTriggerCommand(
        '/trigger add job-chain abc123 error "Fix the tests"',
        ctx,
      );
      assert.ok(result);
      assert.ok(result.text.includes("created"));

      const triggers = getAllTriggers();
      assert.strictEqual(triggers.length, 1);
      assert.strictEqual(triggers[0].condition.kind, "job_complete");
      if (triggers[0].condition.kind === "job_complete") {
        assert.strictEqual(triggers[0].condition.jobId, "abc123");
        assert.strictEqual(triggers[0].condition.onStatus, "error");
      }
    });

    it("creates a job chain with any status", () => {
      handleTriggerCommand(
        '/trigger add job-chain xyz any "Log result"',
        ctx,
      );
      const triggers = getAllTriggers();
      if (triggers[0].condition.kind === "job_complete") {
        assert.strictEqual(triggers[0].condition.onStatus, "any");
      }
    });

    it("shows usage for invalid job-chain format", () => {
      const result = handleTriggerCommand("/trigger add job-chain", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("Usage"));
    });
  });

  describe("/trigger add cloud-complete", () => {
    it("creates a cloud-complete trigger", () => {
      const result = handleTriggerCommand(
        '/trigger add cloud-complete FINISHED "Review PR"',
        ctx,
      );
      assert.ok(result);
      assert.ok(result.text.includes("created"));

      const triggers = getAllTriggers();
      assert.strictEqual(triggers.length, 1);
      assert.strictEqual(triggers[0].condition.kind, "cloud_complete");
      if (triggers[0].condition.kind === "cloud_complete") {
        assert.strictEqual(triggers[0].condition.onStatus, "FINISHED");
      }
    });

    it("creates a cloud-complete with any status", () => {
      handleTriggerCommand(
        '/trigger add cloud-complete any "Log it"',
        ctx,
      );
      const triggers = getAllTriggers();
      if (triggers[0].condition.kind === "cloud_complete") {
        assert.strictEqual(triggers[0].condition.onStatus, "any");
      }
    });

    it("shows usage for invalid cloud-complete format", () => {
      const result = handleTriggerCommand("/trigger add cloud-complete", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("Usage"));
    });
  });

  it("returns error for unknown trigger kind", () => {
    const result = handleTriggerCommand('/trigger add bogus "test"', ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Unknown trigger kind"));
  });

  describe("/trigger list", () => {
    it("shows empty message when no triggers", () => {
      const result = handleTriggerCommand("/trigger list", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("No triggers"));
    });

    it("lists configured triggers", () => {
      handleTriggerCommand('/trigger add webhook hook-a "a"', ctx);
      handleTriggerCommand('/trigger add webhook hook-b "b"', ctx);

      const result = handleTriggerCommand("/trigger list", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("hook-a"));
      assert.ok(result.text.includes("hook-b"));
      assert.ok(result.text.includes("webhook"));
    });
  });

  describe("/trigger remove", () => {
    it("removes a trigger by id prefix", () => {
      handleTriggerCommand('/trigger add webhook to-remove "test"', ctx);
      const triggers = getAllTriggers();
      const id = triggers[0].id;

      const result = handleTriggerCommand(`/trigger remove ${id.slice(0, 6)}`, ctx);
      assert.ok(result);
      assert.ok(result.text.includes("removed"));
      assert.strictEqual(getAllTriggers().length, 0);
    });

    it("shows error for non-existent trigger", () => {
      const result = handleTriggerCommand("/trigger remove nonexistent", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("No trigger found"));
    });
  });

  describe("/trigger enable/disable", () => {
    it("disables and enables a trigger", () => {
      handleTriggerCommand('/trigger add webhook toggle "test"', ctx);
      const triggers = getAllTriggers();
      const id = triggers[0].id;

      assert.strictEqual(triggers[0].enabled, true);

      handleTriggerCommand(`/trigger disable ${id.slice(0, 6)}`, ctx);
      const disabled = findTriggerByIdPrefix(id.slice(0, 6));
      assert.ok(disabled);
      assert.strictEqual(disabled.enabled, false);

      handleTriggerCommand(`/trigger enable ${id.slice(0, 6)}`, ctx);
      const enabled = findTriggerByIdPrefix(id.slice(0, 6));
      assert.ok(enabled);
      assert.strictEqual(enabled.enabled, true);
    });

    it("shows error for non-existent trigger on enable", () => {
      const result = handleTriggerCommand("/trigger enable nonexistent", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("No trigger found"));
    });

    it("shows error for non-existent trigger on disable", () => {
      const result = handleTriggerCommand("/trigger disable nonexistent", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("No trigger found"));
    });
  });

  describe("/trigger info", () => {
    it("shows trigger details", () => {
      handleTriggerCommand(
        '/trigger add webhook info-test "my prompt" --context git_diff --cloud --reflect',
        ctx,
      );
      const triggers = getAllTriggers();
      const id = triggers[0].id;

      const result = handleTriggerCommand(`/trigger info ${id.slice(0, 6)}`, ctx);
      assert.ok(result);
      assert.ok(result.text.includes("info-test"));
      assert.ok(result.text.includes("webhook"));
      assert.ok(result.text.includes("my prompt"));
      assert.ok(result.text.includes("Cloud: yes"));
      assert.ok(result.text.includes("Reflect: on"));
      assert.ok(result.text.includes("git_diff"));
    });

    it("shows error for non-existent trigger", () => {
      const result = handleTriggerCommand("/trigger info nonexistent", ctx);
      assert.ok(result);
      assert.ok(result.text.includes("No trigger found"));
    });
  });
});
