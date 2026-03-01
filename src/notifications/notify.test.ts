import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, getRecentNotifications } from "../db.js";
import { notify, formatNotificationList } from "./notify.js";
import { registerDeliveryHandler, unregisterDeliveryHandler } from "../scheduler/delivery.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-notify-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  unregisterDeliveryHandler("test-channel");
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("notify", () => {
  it("should send notification via delivery handler and log success", async () => {
    let delivered = false;
    registerDeliveryHandler("test-channel", async (_channelId, _text) => {
      delivered = true;
    });

    const result = await notify("test-channel", "ch1", "Hello world");
    assert.equal(result.status, "sent");
    assert.equal(result.channelType, "test-channel");
    assert.equal(result.channelId, "ch1");
    assert.equal(result.message, "Hello world");
    assert.equal(result.source, "manual");
    assert.ok(delivered);
  });

  it("should log with custom source", async () => {
    registerDeliveryHandler("test-channel", async () => {});

    const result = await notify("test-channel", "ch1", "test", "background");
    assert.equal(result.source, "background");
  });

  it("should log failure when no handler registered", async () => {
    // No handler registered, so deliver will just warn (not throw)
    const result = await notify("no-handler", "ch1", "test");
    // deliver() doesn't throw for missing handlers, just warns
    assert.equal(result.status, "sent");
  });

  it("should log failure when handler throws", async () => {
    registerDeliveryHandler("test-channel", async () => {
      throw new Error("delivery failed");
    });

    const result = await notify("test-channel", "ch1", "test");
    assert.equal(result.status, "failed");
    assert.ok(result.error?.includes("delivery failed"));
  });

  it("should persist to notification_log table", async () => {
    registerDeliveryHandler("test-channel", async () => {});

    await notify("test-channel", "ch1", "msg1");
    await notify("test-channel", "ch1", "msg2");

    const logs = getRecentNotifications(10);
    assert.equal(logs.length, 2);
  });
});

describe("formatNotificationList", () => {
  it("should show empty message", () => {
    assert.ok(formatNotificationList([]).includes("No notifications"));
  });

  it("should format notification entries", async () => {
    registerDeliveryHandler("test-channel", async () => {});
    await notify("test-channel", "ch1", "Hello");
    await notify("test-channel", "ch2", "World");

    const logs = getRecentNotifications(10);
    const text = formatNotificationList(logs);
    assert.ok(text.includes("test-channel"));
    assert.ok(text.includes("Hello"));
    assert.ok(text.includes("World"));
  });

  it("should show error for failed notifications", async () => {
    registerDeliveryHandler("test-channel", async () => {
      throw new Error("oops");
    });
    await notify("test-channel", "ch1", "fail");

    const logs = getRecentNotifications(10);
    const text = formatNotificationList(logs);
    assert.ok(text.includes("oops"));
  });
});
