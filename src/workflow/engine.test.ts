import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, addWorkflow, getWorkflow } from "../db.js";
import { interpolateStepConfig, evaluateCondition, executeStep, formatWorkflowInfo, formatWorkflowList } from "./engine.js";
import type { CursorAgentConfig, WorkflowStep } from "../types.js";

let tmpDir: string;
const config: CursorAgentConfig = { cursorPath: "cursor", cwd: "/tmp" };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-wf-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("workflow engine", () => {
  describe("interpolateStepConfig", () => {
    it("should replace step variables", () => {
      const result = interpolateStepConfig(
        "Deploy: {{step.build}}",
        { build: "success output" },
      );
      assert.equal(result, "Deploy: success output");
    });

    it("should replace status variables", () => {
      const result = interpolateStepConfig(
        "Build status: {{step.build.status}}",
        { build: "some output" },
      );
      assert.equal(result, "Build status: success");
    });

    it("should leave missing variables unchanged", () => {
      const result = interpolateStepConfig(
        "Missing: {{step.unknown}}",
        {},
      );
      assert.equal(result, "Missing: {{step.unknown}}");
    });

    it("should handle multiple replacements", () => {
      const result = interpolateStepConfig(
        "{{step.a}} then {{step.b}}",
        { a: "first", b: "second" },
      );
      assert.equal(result, "first then second");
    });
  });

  describe("evaluateCondition", () => {
    it("should evaluate 'true'", () => {
      assert.ok(evaluateCondition("true", {}));
    });

    it("should evaluate 'false'", () => {
      assert.equal(evaluateCondition("false", {}), false);
    });

    it("should evaluate 'success'", () => {
      assert.ok(evaluateCondition("success", {}));
    });

    it("should evaluate 'error'", () => {
      assert.equal(evaluateCondition("error", {}), false);
    });

    it("should evaluate equality", () => {
      assert.ok(evaluateCondition("success == success", {}));
      assert.equal(evaluateCondition("success == error", {}), false);
    });

    it("should evaluate inequality", () => {
      assert.ok(evaluateCondition("success != error", {}));
      assert.equal(evaluateCondition("success != success", {}), false);
    });

    it("should evaluate with step references", () => {
      assert.ok(evaluateCondition("{{step.build.status}} == success", { build: "output" }));
    });
  });

  describe("executeStep", () => {
    it("should execute shell step", async () => {
      const step: WorkflowStep = {
        name: "echo",
        kind: "shell",
        config: { command: "echo hello" },
      };
      const { success, result } = await executeStep(step, {}, config);
      assert.ok(success);
      assert.equal(result, "hello");
    });

    it("should handle shell step failure", async () => {
      const step: WorkflowStep = {
        name: "fail",
        kind: "shell",
        config: { command: "false" },
      };
      const { success } = await executeStep(step, {}, config);
      assert.equal(success, false);
    });

    it("should handle condition step", async () => {
      const step: WorkflowStep = {
        name: "check",
        kind: "condition",
        config: { condition: "true" },
      };
      const { success, result } = await executeStep(step, {}, config);
      assert.ok(success);
      assert.equal(result, "true");
    });

    it("should handle missing command", async () => {
      const step: WorkflowStep = {
        name: "empty",
        kind: "shell",
        config: {},
      };
      const { success } = await executeStep(step, {}, config);
      assert.equal(success, false);
    });

    it("should interpolate step config in shell commands", async () => {
      const step: WorkflowStep = {
        name: "use-prev",
        kind: "shell",
        config: { command: "echo {{step.build}}" },
      };
      const { success, result } = await executeStep(step, { build: "done" }, config);
      assert.ok(success);
      assert.equal(result, "done");
    });
  });

  describe("formatWorkflowInfo", () => {
    it("should format workflow details", () => {
      const w = addWorkflow({
        name: "test",
        description: "A test workflow",
        steps: [{ name: "s1", kind: "shell", config: { command: "echo hi" } }],
        status: "pending",
        currentStep: 0,
        results: {},
        delivery: { kind: "store" },
        createdAt: new Date().toISOString(),
      });
      const text = formatWorkflowInfo(w);
      assert.ok(text.includes("test"));
      assert.ok(text.includes("pending"));
      assert.ok(text.includes("s1"));
    });
  });

  describe("formatWorkflowList", () => {
    it("should handle empty list", () => {
      assert.equal(formatWorkflowList([]), "No workflows.");
    });

    it("should list workflows", () => {
      const w = addWorkflow({
        name: "deploy",
        description: "",
        steps: [{ name: "s1", kind: "shell", config: { command: "echo" } }],
        status: "pending",
        currentStep: 0,
        results: {},
        delivery: { kind: "store" },
        createdAt: new Date().toISOString(),
      });
      const text = formatWorkflowList([w]);
      assert.ok(text.includes("deploy"));
      assert.ok(text.includes("pending"));
    });
  });

  describe("workflow status transitions", () => {
    it("should track completion state in DB", () => {
      const w = addWorkflow({
        name: "tracked",
        description: "",
        steps: [{ name: "s1", kind: "shell", config: { command: "echo" } }],
        status: "pending",
        currentStep: 0,
        results: {},
        delivery: { kind: "store" },
        createdAt: new Date().toISOString(),
      });
      assert.equal(w.status, "pending");
      assert.equal(w.completedAt, null);
    });
  });
});
