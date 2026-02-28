import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readHooksConfig,
  writeHooksConfig,
  addHook,
  removeHook,
  listHooks,
  isValidHookEvent,
} from "./config.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-hooks-test-${Date.now()}`);

describe("Hooks config", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("isValidHookEvent validates known events", () => {
    assert.strictEqual(isValidHookEvent("sessionStart"), true);
    assert.strictEqual(isValidHookEvent("postToolUse"), true);
    assert.strictEqual(isValidHookEvent("invalid"), false);
    assert.strictEqual(isValidHookEvent(""), false);
  });

  it("returns empty config when file does not exist", () => {
    const config = readHooksConfig(TEST_DIR);
    assert.deepStrictEqual(config, { version: 1, hooks: {} });
  });

  it("reads existing config", () => {
    const cursorDir = path.join(TEST_DIR, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorDir, "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ command: "/usr/bin/echo", args: ["hello"] }],
        },
      }),
    );

    const config = readHooksConfig(TEST_DIR);
    assert.strictEqual(Object.keys(config.hooks).length, 1);
    assert.strictEqual(config.hooks.sessionStart[0].command, "/usr/bin/echo");
  });

  it("writes config and creates .cursor/ dir", () => {
    writeHooksConfig(TEST_DIR, {
      version: 1,
      hooks: {
        stop: [{ command: "cleanup.sh" }],
      },
    });

    const filePath = path.join(TEST_DIR, ".cursor", "hooks.json");
    assert.ok(fs.existsSync(filePath));

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.strictEqual(content.hooks.stop[0].command, "cleanup.sh");
  });

  it("adds a hook", () => {
    addHook(TEST_DIR, "sessionStart", { command: "/usr/bin/notify-send", args: ["CureClaw started"] });

    const hooks = listHooks(TEST_DIR);
    assert.strictEqual(hooks.length, 1);
    assert.strictEqual(hooks[0].event, "sessionStart");
    assert.strictEqual(hooks[0].entries.length, 1);
  });

  it("removes a hook", () => {
    addHook(TEST_DIR, "sessionStart", { command: "cmd-a" });
    addHook(TEST_DIR, "sessionStart", { command: "cmd-b" });

    const removed = removeHook(TEST_DIR, "sessionStart", "cmd-a");
    assert.strictEqual(removed, true);

    const hooks = listHooks(TEST_DIR);
    assert.strictEqual(hooks[0].entries.length, 1);
    assert.strictEqual(hooks[0].entries[0].command, "cmd-b");
  });

  it("returns false when removing non-existent hook", () => {
    const removed = removeHook(TEST_DIR, "sessionStart", "nonexistent");
    assert.strictEqual(removed, false);
  });

  it("cleans up empty event arrays on remove", () => {
    addHook(TEST_DIR, "stop", { command: "only-one" });
    removeHook(TEST_DIR, "stop", "only-one");

    const hooks = listHooks(TEST_DIR);
    assert.strictEqual(hooks.length, 0);
  });
});
