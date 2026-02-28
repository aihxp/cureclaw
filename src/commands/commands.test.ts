import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleCommandsCommand } from "./commands.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-commands-cmd-test-${Date.now()}`);

describe("handleCommandsCommand", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-commands input", () => {
    assert.strictEqual(handleCommandsCommand("/mcp list", TEST_DIR), null);
  });

  it("shows help for /run without args", () => {
    const result = handleCommandsCommand("/run", TEST_DIR);
    assert.ok(result?.text.includes("Usage:"));
  });

  it("lists commands", () => {
    const cmdDir = path.join(TEST_DIR, ".cursor", "commands");
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(
      path.join(cmdDir, "code-review.md"),
      '---\ndescription: "Code review"\n---\nReview the code.',
    );

    const result = handleCommandsCommand("/commands", TEST_DIR);
    assert.ok(result?.text.includes("code-review"));
  });

  it("runs a command", () => {
    const cmdDir = path.join(TEST_DIR, ".cursor", "commands");
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(
      path.join(cmdDir, "fix-tests.md"),
      "Fix all failing tests in the project.",
    );

    const result = handleCommandsCommand("/run fix-tests some extra context", TEST_DIR);
    assert.ok(result?.runPrompt?.includes("Fix all failing tests"));
    assert.ok(result?.runPrompt?.includes("some extra context"));
  });

  it("reports command not found", () => {
    const result = handleCommandsCommand("/run nonexistent", TEST_DIR);
    assert.ok(result?.text.includes("not found"));
  });
});
