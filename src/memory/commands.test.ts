import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase } from "../db.js";
import { handleMemoryCommand } from "./commands.js";
import { remember } from "./memory.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-memcmd-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleMemoryCommand", () => {
  it("should return null for non-memory commands", () => {
    assert.equal(handleMemoryCommand("/help"), null);
    assert.equal(handleMemoryCommand("/jobs"), null);
  });

  it("should handle /remember with key and content", () => {
    const result = handleMemoryCommand('/remember api-key Use AUTH_TOKEN');
    assert.ok(result);
    assert.ok(result.text.includes("Remembered"));
    assert.ok(result.text.includes("api-key"));
  });

  it("should handle /remember with --tags", () => {
    const result = handleMemoryCommand('/remember deploy Run deploy.sh --tags ops,prod');
    assert.ok(result);
    assert.ok(result.text.includes("Remembered"));
  });

  it("should handle /remember missing content", () => {
    const result = handleMemoryCommand('/remember keyonly');
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("should handle /remember missing args", () => {
    const result = handleMemoryCommand('/remember ');
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("should handle /recall with query", () => {
    remember("api", "token value");
    const result = handleMemoryCommand('/recall api');
    assert.ok(result);
    assert.ok(result.text.includes("api"));
  });

  it("should handle /recall with no query (list all)", () => {
    remember("a", "first");
    remember("b", "second");
    const result = handleMemoryCommand('/recall');
    assert.ok(result);
    assert.ok(result.text.includes("a"));
    assert.ok(result.text.includes("b"));
  });

  it("should handle /recall no results", () => {
    const result = handleMemoryCommand('/recall zzzznotfound');
    assert.ok(result);
    assert.ok(result.text.includes("No memories matching"));
  });

  it("should handle /forget valid key", () => {
    remember("temp", "data");
    const result = handleMemoryCommand('/forget temp');
    assert.ok(result);
    assert.ok(result.text.includes('Forgot "temp"'));
  });

  it("should handle /forget missing key", () => {
    const result = handleMemoryCommand('/forget ');
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("should handle /forget nonexistent", () => {
    const result = handleMemoryCommand('/forget nope');
    assert.ok(result);
    assert.ok(result.text.includes('No memory with key'));
  });

  it("should show help for /memory help", () => {
    const result = handleMemoryCommand('/memory help');
    assert.ok(result);
    assert.ok(result.text.includes("/remember"));
    assert.ok(result.text.includes("/recall"));
    assert.ok(result.text.includes("/forget"));
  });
});
