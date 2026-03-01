import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, addWorkflow, updateWorkflow } from "../db.js";
import { handleWorkflowCommand } from "./commands.js";
import type { CursorAgentConfig } from "../types.js";

let tmpDir: string;
const ctx = { channelType: "cli", channelId: "cli" };
const config: CursorAgentConfig = { cursorPath: "cursor", cwd: "/tmp" };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-wfcmd-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleWorkflowCommand", () => {
  it("should return null for non-workflow commands", () => {
    assert.equal(handleWorkflowCommand("/help", ctx), null);
    assert.equal(handleWorkflowCommand("/jobs", ctx), null);
  });

  it("should show help for /workflow help", () => {
    const result = handleWorkflowCommand("/workflow help", ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("create"));
    assert.ok((result as any).text.includes("run"));
  });

  it("should show help for /workflow", () => {
    const result = handleWorkflowCommand("/workflow", ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("create"));
  });

  it("should handle /workflow create valid", () => {
    const result = handleWorkflowCommand(
      '/workflow create deploy [{"name":"build","kind":"shell","config":{"command":"echo ok"}}]',
      ctx,
    );
    assert.ok(result);
    const text = (result as any).text;
    assert.ok(text.includes("deploy"));
    assert.ok(text.includes("created"));
    assert.ok(text.includes("1 steps"));
  });

  it("should handle /workflow create invalid JSON", () => {
    const result = handleWorkflowCommand('/workflow create bad {not-json', ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("Invalid JSON"));
  });

  it("should handle /workflow create missing name", () => {
    const result = handleWorkflowCommand('/workflow create', ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("Usage"));
  });

  it("should handle /workflow list empty", () => {
    const result = handleWorkflowCommand("/workflow list", ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("No workflows"));
  });

  it("should handle /workflow list with entries", () => {
    addWorkflow({
      name: "test",
      description: "",
      steps: [{ name: "s1", kind: "shell", config: { command: "echo" } }],
      status: "pending",
      currentStep: 0,
      results: {},
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
    });
    const result = handleWorkflowCommand("/workflow list", ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("test"));
  });

  it("should handle /workflow status", () => {
    const w = addWorkflow({
      name: "test",
      description: "desc",
      steps: [{ name: "s1", kind: "shell", config: { command: "echo" } }],
      status: "pending",
      currentStep: 0,
      results: {},
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
    });
    const result = handleWorkflowCommand(`/workflow status ${w.id}`, ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("test"));
    assert.ok((result as any).text.includes("pending"));
  });

  it("should handle /workflow stop running workflow", () => {
    const w = addWorkflow({
      name: "runner",
      description: "",
      steps: [{ name: "s1", kind: "shell", config: { command: "echo" } }],
      status: "running",
      currentStep: 0,
      results: {},
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
    });
    const result = handleWorkflowCommand(`/workflow stop ${w.id}`, ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("stopped"));
  });

  it("should handle /workflow stop non-running", () => {
    const w = addWorkflow({
      name: "done",
      description: "",
      steps: [{ name: "s1", kind: "shell", config: { command: "echo" } }],
      status: "completed",
      currentStep: 1,
      results: {},
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
    });
    const result = handleWorkflowCommand(`/workflow stop ${w.id}`, ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("not running"));
  });

  it("should handle /workflow remove", () => {
    const w = addWorkflow({
      name: "removeme",
      description: "",
      steps: [{ name: "s1", kind: "shell", config: { command: "echo" } }],
      status: "pending",
      currentStep: 0,
      results: {},
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
    });
    const result = handleWorkflowCommand(`/workflow remove ${w.id}`, ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("removed"));
  });

  it("should handle /workflow remove unknown", () => {
    const result = handleWorkflowCommand("/workflow remove zzzzz", ctx);
    assert.ok(result);
    assert.ok((result as any).text.includes("No workflow found"));
  });

  it("should handle /workflow run with shell steps", async () => {
    const w = addWorkflow({
      name: "echo-test",
      description: "",
      steps: [{ name: "greet", kind: "shell", config: { command: "echo hello" } }],
      status: "pending",
      currentStep: 0,
      results: {},
      delivery: { kind: "store" },
      createdAt: new Date().toISOString(),
    });
    const result = await handleWorkflowCommand(`/workflow run ${w.id}`, ctx, config);
    assert.ok(result);
    const text = (result as any).text;
    assert.ok(text.includes("completed"));
    assert.ok(text.includes("hello"));
  });
});
