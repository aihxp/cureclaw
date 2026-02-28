import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleHooksCommand } from "./commands.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-hooks-cmd-test-${Date.now()}`);

describe("handleHooksCommand", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-hooks commands", () => {
    assert.strictEqual(handleHooksCommand("/mcp list", TEST_DIR), null);
  });

  it("shows help for /hooks", () => {
    const result = handleHooksCommand("/hooks", TEST_DIR);
    assert.ok(result?.text.includes("Hooks commands:"));
  });

  it("adds and lists a hook", () => {
    const addResult = handleHooksCommand("/hooks add sessionStart /usr/bin/echo hello", TEST_DIR);
    assert.ok(addResult?.text.includes("Hook added"));

    const listResult = handleHooksCommand("/hooks list", TEST_DIR);
    assert.ok(listResult?.text.includes("sessionStart"));
    assert.ok(listResult?.text.includes("/usr/bin/echo"));
  });

  it("rejects invalid event name", () => {
    const result = handleHooksCommand("/hooks add invalidEvent cmd", TEST_DIR);
    assert.ok(result?.text.includes("Invalid hook event"));
  });

  it("removes a hook", () => {
    handleHooksCommand("/hooks add stop cleanup.sh", TEST_DIR);
    const result = handleHooksCommand("/hooks remove stop cleanup.sh", TEST_DIR);
    assert.ok(result?.text.includes("Hook removed"));

    const listResult = handleHooksCommand("/hooks list", TEST_DIR);
    assert.ok(listResult?.text.includes("No hooks configured"));
  });
});
