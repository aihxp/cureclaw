import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase } from "../db.js";
import { handleNotifyCommand } from "./commands.js";
import { registerDeliveryHandler, unregisterDeliveryHandler } from "../scheduler/delivery.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-notifycmd-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  unregisterDeliveryHandler("test-channel");
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleNotifyCommand", () => {
  it("should return null for non-notify commands", () => {
    assert.equal(handleNotifyCommand("/help"), null);
    assert.equal(handleNotifyCommand("/jobs"), null);
  });

  it("should show help for /notify", () => {
    const result = handleNotifyCommand("/notify");
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("/notify"));
  });

  it("should show help for /notify help", () => {
    const result = handleNotifyCommand("/notify help");
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("channelType"));
  });

  it("should send notification", async () => {
    registerDeliveryHandler("telegram", async () => {});
    const result = await handleNotifyCommand('/notify telegram:123 "Hello world"');
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("sent"));
  });

  it("should handle send with missing message", async () => {
    const result = await handleNotifyCommand("/notify telegram");
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("Usage"));
  });

  it("should handle /notify log", () => {
    const result = handleNotifyCommand("/notify log");
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("No notifications"));
  });

  it("should handle /notify log with limit", () => {
    const result = handleNotifyCommand("/notify log 5");
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("No notifications"));
  });

  it("should handle failed notification", async () => {
    registerDeliveryHandler("test-channel", async () => {
      throw new Error("connection error");
    });
    const result = await handleNotifyCommand('/notify test-channel:ch1 "test"');
    assert.ok(result);
    assert.ok((result as { text: string }).text.includes("failed"));
  });
});
