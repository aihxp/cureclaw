import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase } from "../db.js";
import { handleWorktreeCommand } from "./commands.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-wt-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleWorktreeCommand", () => {
  it("should return null for non-worktree commands", () => {
    assert.equal(handleWorktreeCommand("/help"), null);
    assert.equal(handleWorktreeCommand("/jobs"), null);
  });

  it("should show help for /worktree", () => {
    const result = handleWorktreeCommand("/worktree");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("/worktree create"));
    assert.ok(text.includes("/worktree list"));
  });

  it("should show help for /worktree help", () => {
    const result = handleWorktreeCommand("/worktree help");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("/worktree create"));
    assert.ok(text.includes("/worktree remove"));
    assert.ok(text.includes("/worktree cleanup"));
  });

  it("should list worktrees when none exist", () => {
    const result = handleWorktreeCommand("/worktree list");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("No active worktrees"));
  });

  it("should require branch for create", async () => {
    const result = handleWorktreeCommand("/worktree create ");
    assert.ok(result);
    const resolved = result instanceof Promise ? await result : result;
    assert.ok(resolved.text.includes("Usage") || resolved.text.includes("Error"));
  });

  it("should require branch for remove", async () => {
    const result = handleWorktreeCommand("/worktree remove ");
    assert.ok(result);
    const resolved = result instanceof Promise ? await result : result;
    assert.ok(resolved.text.includes("Usage") || resolved.text.includes("not found"));
  });

  it("should handle remove for non-existent branch", async () => {
    const result = handleWorktreeCommand("/worktree remove non-existent-branch");
    assert.ok(result);
    const resolved = result instanceof Promise ? await result : result;
    assert.ok(resolved.text.includes("not found"));
  });

  it("should handle cleanup when no stale worktrees", async () => {
    const result = handleWorktreeCommand("/worktree cleanup");
    assert.ok(result);
    const resolved = result instanceof Promise ? await result : result;
    assert.ok(resolved.text.includes("No stale") || resolved.text.includes("Cleaned up") || resolved.text.includes("Error"));
  });

  it("should return null for unknown subcommands that don't start with /worktree", () => {
    assert.equal(handleWorktreeCommand("/work"), null);
    assert.equal(handleWorktreeCommand("/tree"), null);
  });

  it("should show help for unknown worktree subcommand", () => {
    const result = handleWorktreeCommand("/worktree foobar");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("/worktree create"));
  });
});
