import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase } from "../db.js";
import { buildAdaptedPrompt, evaluateShell, evaluateTest } from "./evaluators.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-adapt-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildAdaptedPrompt", () => {
  it("should include attempt number", () => {
    const result = buildAdaptedPrompt("fix the bug", "test failed", 2);
    assert.ok(result.includes("Attempt 2"));
  });

  it("should include failure context", () => {
    const result = buildAdaptedPrompt("fix the bug", "TypeError: x is undefined", 3);
    assert.ok(result.includes("TypeError: x is undefined"));
  });

  it("should include original prompt", () => {
    const result = buildAdaptedPrompt("fix the login bug", "test failed", 2);
    assert.ok(result.includes("fix the login bug"));
  });

  it("should include fix instruction", () => {
    const result = buildAdaptedPrompt("task", "errors", 2);
    assert.ok(result.includes("Fix the issues"));
  });
});

describe("evaluateShell", () => {
  it("should pass for successful command", () => {
    const result = evaluateShell("echo success");
    assert.equal(result.passed, true);
    assert.ok(result.context.includes("success"));
  });

  it("should fail for unsuccessful command", () => {
    const result = evaluateShell("false");
    assert.equal(result.passed, false);
  });

  it("should capture error output", () => {
    const result = evaluateShell("echo error-output >&2 && false");
    assert.equal(result.passed, false);
    assert.ok(result.context.includes("error-output"));
  });
});

describe("evaluateTest", () => {
  it("should pass for successful test command", () => {
    const result = evaluateTest("echo tests-passed");
    assert.equal(result.passed, true);
  });

  it("should fail for failing test command", () => {
    const result = evaluateTest("false");
    assert.equal(result.passed, false);
  });

  it("should use npm test as default", () => {
    // This will likely fail since npm test might not be configured in tmpdir
    // but it shouldn't throw
    const result = evaluateTest(undefined, tmpDir);
    assert.equal(typeof result.passed, "boolean");
    assert.equal(typeof result.context, "string");
  });
});
