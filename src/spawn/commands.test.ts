import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase } from "../db.js";
import { handleSpawnCommand } from "./commands.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-spawn-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleSpawnCommand", () => {
  it("should return null for non-spawn commands", () => {
    assert.equal(handleSpawnCommand("/help"), null);
    assert.equal(handleSpawnCommand("/jobs"), null);
  });

  it("should show help for /spawn", () => {
    const result = handleSpawnCommand("/spawn");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("/spawn"));
    assert.ok(text.includes("list"));
  });

  it("should show help for /spawn help", () => {
    const result = handleSpawnCommand("/spawn help");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("steer"));
    assert.ok(text.includes("kill"));
    assert.ok(text.includes("log"));
  });

  it("should list processes when none exist", () => {
    const result = handleSpawnCommand("/spawn list");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("No spawned processes"));
  });

  it("should spawn a simple process", async () => {
    const result = handleSpawnCommand("/spawn test-proc echo hello");
    assert.ok(result);
    const resolved = result instanceof Promise ? await result : result;
    assert.ok(resolved.text.includes("test-proc") && resolved.text.includes("spawned"));
  });

  it("should list spawned process", async () => {
    // Spawn first
    const spawnResult = handleSpawnCommand("/spawn lister echo hi");
    assert.ok(spawnResult);
    await (spawnResult instanceof Promise ? spawnResult : Promise.resolve(spawnResult));

    // Small wait for process to register
    await new Promise((r) => setTimeout(r, 100));

    const result = handleSpawnCommand("/spawn list");
    assert.ok(result);
    const resolved = result instanceof Promise ? await result : result;
    assert.ok(resolved.text.includes("lister"));
  });

  it("should read log for spawned process", async () => {
    const spawnResult = handleSpawnCommand("/spawn logger echo log-test-output");
    assert.ok(spawnResult);
    await (spawnResult instanceof Promise ? spawnResult : Promise.resolve(spawnResult));

    // Wait for process to write output
    await new Promise((r) => setTimeout(r, 200));

    const result = handleSpawnCommand("/spawn log logger");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("Log for"));
  });

  it("should kill a spawned process", async () => {
    const spawnResult = handleSpawnCommand("/spawn killer sleep 60");
    assert.ok(spawnResult);
    await (spawnResult instanceof Promise ? spawnResult : Promise.resolve(spawnResult));

    await new Promise((r) => setTimeout(r, 100));

    const result = handleSpawnCommand("/spawn kill killer");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("killed"));
  });

  it("should fail to kill non-existent process", () => {
    const result = handleSpawnCommand("/spawn kill nonexistent");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("not found"));
  });

  it("should fail to steer non-existent process", () => {
    const result = handleSpawnCommand('/spawn steer nonexistent "hello"');
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("Cannot steer") || text.includes("not running"));
  });

  it("should handle log for non-existent process", () => {
    const result = handleSpawnCommand("/spawn log nonexistent");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("not found"));
  });

  it("should reject duplicate process name", async () => {
    const first = handleSpawnCommand("/spawn duptest sleep 60");
    assert.ok(first);
    await (first instanceof Promise ? first : Promise.resolve(first));

    await new Promise((r) => setTimeout(r, 100));

    const second = handleSpawnCommand("/spawn duptest sleep 60");
    assert.ok(second);
    const resolved = second instanceof Promise ? await second : second;
    assert.ok(resolved.text.includes("already running") || resolved.text.includes("Error"));

    // Cleanup — kill the process to prevent async activity after test
    handleSpawnCommand("/spawn kill duptest");
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should handle steer usage (no args)", () => {
    const result = handleSpawnCommand("/spawn steer");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("Usage"));
  });
});
