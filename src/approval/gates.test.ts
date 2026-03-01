import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, addApprovalGate, updateApprovalGate } from "../db.js";
import { checkApproval, findMatchingGate, formatGatesList, formatGateInfo } from "./gates.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-gate-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("approval gates", () => {
  describe("checkApproval", () => {
    it("should return allow when no gates exist", () => {
      assert.equal(checkApproval("shell", "ls"), "allow");
    });

    it("should match deny gate", () => {
      addApprovalGate({
        name: "no-rm",
        pattern: "rm\\s+-rf",
        action: "deny",
        reason: "Prevent recursive delete",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      assert.equal(checkApproval("shell", "rm -rf /"), "deny");
    });

    it("should match allow gate", () => {
      addApprovalGate({
        name: "allow-reads",
        pattern: "readFile",
        action: "allow",
        reason: "File reads are safe",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      assert.equal(checkApproval("readFile", "read something"), "allow");
    });

    it("should use first match (creation order)", () => {
      addApprovalGate({
        name: "deny-push",
        pattern: "git.*push",
        action: "deny",
        reason: "Block pushes",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      addApprovalGate({
        name: "allow-git",
        pattern: "git",
        action: "allow",
        reason: "Allow git",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      assert.equal(checkApproval("shell", "git push origin main"), "deny");
    });

    it("should skip disabled gates", () => {
      const gate = addApprovalGate({
        name: "block-all",
        pattern: ".*",
        action: "deny",
        reason: "Block everything",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      updateApprovalGate(gate.id, { enabled: false });
      assert.equal(checkApproval("anything", "at all"), "allow");
    });

    it("should handle ask action", () => {
      addApprovalGate({
        name: "confirm-deploy",
        pattern: "deploy",
        action: "ask",
        reason: "Confirm deployments",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      assert.equal(checkApproval("shell", "deploy to staging"), "ask");
    });
  });

  describe("findMatchingGate", () => {
    it("should return the matching gate", () => {
      addApprovalGate({
        name: "no-rm",
        pattern: "rm\\s+-rf",
        action: "deny",
        reason: "No recursive delete",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      const gate = findMatchingGate("shell", "rm -rf /tmp");
      assert.ok(gate);
      assert.equal(gate.name, "no-rm");
    });

    it("should return undefined when no match", () => {
      const gate = findMatchingGate("read", "file.txt");
      assert.equal(gate, undefined);
    });
  });

  describe("formatGatesList", () => {
    it("should handle empty list", () => {
      assert.equal(formatGatesList([]), "No approval gates configured.");
    });

    it("should format gates", () => {
      const gate = addApprovalGate({
        name: "test",
        pattern: "foo",
        action: "deny",
        reason: "test reason",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      const text = formatGatesList([gate]);
      assert.ok(text.includes("test"));
      assert.ok(text.includes("deny"));
    });
  });

  describe("formatGateInfo", () => {
    it("should include all fields", () => {
      const gate = addApprovalGate({
        name: "test-gate",
        pattern: "rm",
        action: "deny",
        reason: "safety",
        delivery: { kind: "store" },
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      const text = formatGateInfo(gate);
      assert.ok(text.includes("test-gate"));
      assert.ok(text.includes("deny"));
      assert.ok(text.includes("safety"));
    });
  });
});
