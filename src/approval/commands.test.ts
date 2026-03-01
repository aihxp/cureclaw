import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, addApprovalGate } from "../db.js";
import { handleApprovalCommand } from "./commands.js";

let tmpDir: string;
const ctx = { channelType: "cli", channelId: "cli" };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-apcmd-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleApprovalCommand", () => {
  it("should return null for non-approval commands", () => {
    assert.equal(handleApprovalCommand("/help", ctx), null);
    assert.equal(handleApprovalCommand("/jobs", ctx), null);
  });

  it("should show help for /approval help", () => {
    const result = handleApprovalCommand("/approval help", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("/approval add"));
    assert.ok(result.text.includes("/approval list"));
  });

  it("should show help for /approval", () => {
    const result = handleApprovalCommand("/approval", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("/approval add"));
  });

  it("should handle /approval add with quoted reason", () => {
    const result = handleApprovalCommand('/approval add no-rm rm\\s+-rf deny "Prevent recursive delete"', ctx);
    assert.ok(result);
    assert.ok(result.text.includes("no-rm"));
    assert.ok(result.text.includes("deny"));
  });

  it("should handle /approval add with unquoted reason", () => {
    const result = handleApprovalCommand('/approval add no-push git\\s+push deny Block pushes', ctx);
    assert.ok(result);
    assert.ok(result.text.includes("no-push"));
  });

  it("should handle /approval add missing args", () => {
    const result = handleApprovalCommand('/approval add', ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("should handle /approval add invalid regex", () => {
    const result = handleApprovalCommand('/approval add bad [invalid deny reason', ctx);
    assert.ok(result);
    assert.ok(result.text.includes("Invalid regex"));
  });

  it("should handle /approval list", () => {
    addApprovalGate({
      name: "test",
      pattern: "foo",
      action: "deny",
      reason: "test",
      delivery: { kind: "store" },
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    const result = handleApprovalCommand("/approval list", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("test"));
  });

  it("should handle /approval remove", () => {
    const gate = addApprovalGate({
      name: "removeme",
      pattern: "test",
      action: "deny",
      reason: "test",
      delivery: { kind: "store" },
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    const result = handleApprovalCommand(`/approval remove ${gate.id}`, ctx);
    assert.ok(result);
    assert.ok(result.text.includes("removed"));
  });

  it("should handle /approval remove unknown", () => {
    const result = handleApprovalCommand("/approval remove zzzzz", ctx);
    assert.ok(result);
    assert.ok(result.text.includes("No gate found"));
  });

  it("should handle /approval enable", () => {
    const gate = addApprovalGate({
      name: "toggle",
      pattern: "test",
      action: "deny",
      reason: "test",
      delivery: { kind: "store" },
      enabled: false,
      createdAt: new Date().toISOString(),
    });
    const result = handleApprovalCommand(`/approval enable ${gate.id}`, ctx);
    assert.ok(result);
    assert.ok(result.text.includes("enabled"));
  });

  it("should handle /approval disable", () => {
    const gate = addApprovalGate({
      name: "toggle2",
      pattern: "test",
      action: "deny",
      reason: "test",
      delivery: { kind: "store" },
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    const result = handleApprovalCommand(`/approval disable ${gate.id}`, ctx);
    assert.ok(result);
    assert.ok(result.text.includes("disabled"));
  });
});
