import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  gatherContext,
  interpolateContext,
  interpolateEvent,
  parseContextProvider,
  isValidContextKind,
} from "./context.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-context-test-${Date.now()}`);

describe("isValidContextKind", () => {
  it("accepts valid kinds", () => {
    assert.ok(isValidContextKind("git_diff"));
    assert.ok(isValidContextKind("git_log"));
    assert.ok(isValidContextKind("shell"));
    assert.ok(isValidContextKind("file"));
  });

  it("rejects invalid kinds", () => {
    assert.ok(!isValidContextKind("unknown"));
    assert.ok(!isValidContextKind(""));
  });
});

describe("parseContextProvider", () => {
  it("parses bare kind", () => {
    const p = parseContextProvider("git_diff");
    assert.strictEqual(p.kind, "git_diff");
    assert.strictEqual(p.name, "diff");
    assert.strictEqual(p.arg, undefined);
  });

  it("parses kind with arg", () => {
    const p = parseContextProvider("git_log:20");
    assert.strictEqual(p.kind, "git_log");
    assert.strictEqual(p.name, "log");
    assert.strictEqual(p.arg, "20");
  });

  it("parses shell with command", () => {
    const p = parseContextProvider("shell:npm test");
    assert.strictEqual(p.kind, "shell");
    assert.strictEqual(p.name, "shell");
    assert.strictEqual(p.arg, "npm test");
  });

  it("parses file with path", () => {
    const p = parseContextProvider("file:src/main.ts");
    assert.strictEqual(p.kind, "file");
    assert.strictEqual(p.name, "main");
    assert.strictEqual(p.arg, "src/main.ts");
  });

  it("throws for invalid kind", () => {
    assert.throws(() => parseContextProvider("bogus"), /Invalid context kind/);
  });
});

describe("gatherContext", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty map for empty providers", async () => {
    const result = await gatherContext([], TEST_DIR);
    assert.strictEqual(result.size, 0);
  });

  it("runs shell provider", async () => {
    const result = await gatherContext(
      [{ name: "echo", kind: "shell", arg: "echo hello" }],
      TEST_DIR,
    );
    assert.strictEqual(result.get("echo"), "hello");
  });

  it("runs file provider", async () => {
    fs.writeFileSync(path.join(TEST_DIR, "test.txt"), "file contents here");
    const result = await gatherContext(
      [{ name: "test", kind: "file", arg: "test.txt" }],
      TEST_DIR,
    );
    assert.strictEqual(result.get("test"), "file contents here");
  });

  it("runs git_diff in a git repo", async () => {
    execSync("git init", { cwd: TEST_DIR });
    execSync("git config user.email test@test.com && git config user.name Test", { cwd: TEST_DIR });
    fs.writeFileSync(path.join(TEST_DIR, "a.txt"), "initial");
    execSync("git add . && git commit -m init", { cwd: TEST_DIR });
    fs.writeFileSync(path.join(TEST_DIR, "a.txt"), "changed");

    const result = await gatherContext(
      [{ name: "diff", kind: "git_diff" }],
      TEST_DIR,
    );
    assert.ok(result.get("diff")!.includes("changed"));
  });

  it("runs git_log in a git repo", async () => {
    execSync("git init", { cwd: TEST_DIR });
    execSync("git config user.email test@test.com && git config user.name Test", { cwd: TEST_DIR });
    fs.writeFileSync(path.join(TEST_DIR, "a.txt"), "initial");
    execSync("git add . && git commit -m 'first commit'", { cwd: TEST_DIR });

    const result = await gatherContext(
      [{ name: "log", kind: "git_log", arg: "5" }],
      TEST_DIR,
    );
    assert.ok(result.get("log")!.includes("first commit"));
  });

  it("captures error for nonexistent file", async () => {
    const result = await gatherContext(
      [{ name: "missing", kind: "file", arg: "nonexistent.txt" }],
      TEST_DIR,
    );
    assert.ok(result.get("missing")!.startsWith("(error:"));
  });

  it("captures error for failing shell command", async () => {
    const result = await gatherContext(
      [{ name: "fail", kind: "shell", arg: "false" }],
      TEST_DIR,
    );
    assert.ok(result.get("fail")!.startsWith("(error:"));
  });
});

describe("interpolateContext", () => {
  it("replaces single placeholder", () => {
    const ctx = new Map([["diff", "some diff output"]]);
    const result = interpolateContext("Changes:\n{{context.diff}}", ctx);
    assert.strictEqual(result, "Changes:\nsome diff output");
  });

  it("replaces multiple placeholders", () => {
    const ctx = new Map([["diff", "d"], ["log", "l"]]);
    const result = interpolateContext("{{context.diff}} and {{context.log}}", ctx);
    assert.strictEqual(result, "d and l");
  });

  it("leaves unresolved placeholders as-is", () => {
    const ctx = new Map<string, string>();
    const result = interpolateContext("{{context.unknown}}", ctx);
    assert.strictEqual(result, "{{context.unknown}}");
  });
});

describe("interpolateEvent", () => {
  it("replaces event placeholders", () => {
    const result = interpolateEvent(
      "Status: {{event.status}}, Result: {{event.result}}",
      { status: "success", result: "all good" },
    );
    assert.strictEqual(result, "Status: success, Result: all good");
  });

  it("leaves unresolved event placeholders as-is", () => {
    const result = interpolateEvent("{{event.unknown}}", {});
    assert.strictEqual(result, "{{event.unknown}}");
  });
});
