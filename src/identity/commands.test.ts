import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase } from "../db.js";
import { handleIdentityCommand } from "./commands.js";
import { setIdentityField } from "./identity.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-idcmd-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleIdentityCommand", () => {
  it("should return null for non-identity commands", () => {
    assert.equal(handleIdentityCommand("/help"), null);
    assert.equal(handleIdentityCommand("/jobs"), null);
    assert.equal(handleIdentityCommand("/remember x y"), null);
  });

  it("should show help for /identity", () => {
    const result = handleIdentityCommand("/identity");
    assert.ok(result);
    assert.ok(result.text.includes("/identity set"));
  });

  it("should show help for /identity help", () => {
    const result = handleIdentityCommand("/identity help");
    assert.ok(result);
    assert.ok(result.text.includes("/identity set"));
    assert.ok(result.text.includes("/identity show"));
    assert.ok(result.text.includes("/identity list"));
  });

  it("should handle /identity set name", () => {
    const result = handleIdentityCommand('/identity set name "TestBot"');
    assert.ok(result);
    assert.ok(result.text.includes("TestBot"));
    assert.ok(result.text.includes("global"));
  });

  it("should handle /identity set name with scope", () => {
    const result = handleIdentityCommand('/identity set name "SlackBot" --scope slack');
    assert.ok(result);
    assert.ok(result.text.includes("SlackBot"));
    assert.ok(result.text.includes("slack"));
  });

  it("should handle /identity set greeting", () => {
    const result = handleIdentityCommand('/identity set greeting "Hello there!"');
    assert.ok(result);
    assert.ok(result.text.includes("Hello there!"));
  });

  it("should handle /identity set prompt", () => {
    const result = handleIdentityCommand('/identity set prompt "You are helpful"');
    assert.ok(result);
    assert.ok(result.text.includes("You are helpful"));
  });

  it("should handle /identity set avatar", () => {
    const result = handleIdentityCommand('/identity set avatar "https://example.com/pic.png"');
    assert.ok(result);
    assert.ok(result.text.includes("https://example.com/pic.png"));
  });

  it("should handle /identity show with no identity", () => {
    const result = handleIdentityCommand("/identity show");
    assert.ok(result);
    assert.ok(result.text.includes("No identity"));
  });

  it("should handle /identity show after setting", () => {
    setIdentityField("name", "Bot");
    const result = handleIdentityCommand("/identity show");
    assert.ok(result);
    assert.ok(result.text.includes("Bot"));
  });

  it("should handle /identity list empty", () => {
    const result = handleIdentityCommand("/identity list");
    assert.ok(result);
    assert.ok(result.text.includes("No identities"));
  });

  it("should handle /identity list with entries", () => {
    setIdentityField("name", "GlobalBot");
    setIdentityField("name", "SlackBot", "slack");
    const result = handleIdentityCommand("/identity list");
    assert.ok(result);
    assert.ok(result.text.includes("GlobalBot"));
    assert.ok(result.text.includes("SlackBot"));
  });

  it("should handle /identity remove", () => {
    setIdentityField("name", "Bot", "slack");
    const result = handleIdentityCommand("/identity remove slack");
    assert.ok(result);
    assert.ok(result.text.includes("removed"));
  });

  it("should handle /identity remove nonexistent", () => {
    const result = handleIdentityCommand("/identity remove discord");
    assert.ok(result);
    assert.ok(result.text.includes("No identity"));
  });

  it("should handle /identity set with invalid field", () => {
    const result = handleIdentityCommand("/identity set invalid value");
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });
});
