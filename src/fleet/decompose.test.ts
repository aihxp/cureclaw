import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlannerPrompt, parseSubtasks } from "./decompose.js";

describe("buildPlannerPrompt", () => {
  it("includes goal and worker count", () => {
    const prompt = buildPlannerPrompt("make auth production-ready", 3);
    assert.ok(prompt.includes("make auth production-ready"));
    assert.ok(prompt.includes("3 independent subtasks"));
  });

  it("includes JSON array instruction", () => {
    const prompt = buildPlannerPrompt("goal", 2);
    assert.ok(prompt.includes("JSON array"));
  });
});

describe("parseSubtasks", () => {
  it("parses valid JSON array", () => {
    const input = `[
      {"name": "fix-auth", "task": "Fix authentication bugs"},
      {"name": "add-tests", "task": "Write integration tests"}
    ]`;
    const result = parseSubtasks(input);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, "fix-auth");
    assert.strictEqual(result[0].task, "Fix authentication bugs");
    assert.strictEqual(result[1].name, "add-tests");
  });

  it("parses JSON inside markdown fences", () => {
    const input = '```json\n[{"name": "task-1", "task": "Do something"}]\n```';
    const result = parseSubtasks(input);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "task-1");
  });

  it("parses JSON inside plain fences", () => {
    const input = '```\n[{"name": "task-1", "task": "Do something"}]\n```';
    const result = parseSubtasks(input);
    assert.strictEqual(result.length, 1);
  });

  it("extracts JSON array from surrounding text", () => {
    const input = 'Here are the subtasks:\n[{"name": "a", "task": "b"}]\nDone.';
    const result = parseSubtasks(input);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "a");
  });

  it("returns empty array for no JSON", () => {
    const result = parseSubtasks("no json here");
    assert.strictEqual(result.length, 0);
  });

  it("returns empty array for invalid JSON", () => {
    const result = parseSubtasks("[{invalid json}]");
    assert.strictEqual(result.length, 0);
  });

  it("filters out items with missing name or task", () => {
    const input = '[{"name": "ok", "task": "valid"}, {"name": "", "task": "no name"}, {"task": "no name field"}]';
    const result = parseSubtasks(input);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "ok");
  });

  it("trims whitespace from name and task", () => {
    const input = '[{"name": "  spaced  ", "task": "  padded  "}]';
    const result = parseSubtasks(input);
    assert.strictEqual(result[0].name, "spaced");
    assert.strictEqual(result[0].task, "padded");
  });
});
