import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpolatePrompt, parsePipelineArgs } from "./pipeline.js";

describe("interpolatePrompt", () => {
  it("replaces {{prev}} with previous result", () => {
    const result = interpolatePrompt("Review: {{prev}}", new Map(), "hello world");
    assert.equal(result, "Review: hello world");
  });

  it("replaces {{step.N}} with step result", () => {
    const results = new Map([[0, "step zero"], [1, "step one"]]);
    const result = interpolatePrompt("Combine {{step.0}} and {{step.1}}", results, "");
    assert.equal(result, "Combine step zero and step one");
  });

  it("leaves unresolved {{step.N}} references as-is", () => {
    const result = interpolatePrompt("Use {{step.5}}", new Map(), "");
    assert.equal(result, "Use {{step.5}}");
  });

  it("handles multiple {{prev}} replacements", () => {
    const result = interpolatePrompt("{{prev}} then {{prev}}", new Map(), "X");
    assert.equal(result, "X then X");
  });

  it("returns template unchanged when no variables present", () => {
    const result = interpolatePrompt("plain text", new Map(), "prev");
    assert.equal(result, "plain text");
  });
});

describe("parsePipelineArgs", () => {
  it("parses simple quoted steps", () => {
    const pipeline = parsePipelineArgs('"step one" "step two"');
    assert.ok(pipeline);
    assert.equal(pipeline.steps.length, 2);
    assert.equal(pipeline.steps[0].prompt, "step one");
    assert.equal(pipeline.steps[1].prompt, "step two");
    assert.equal(pipeline.steps[0].reflect, undefined);
  });

  it("parses --reflect flag on preceding step", () => {
    const pipeline = parsePipelineArgs('"implement it" --reflect "test it"');
    assert.ok(pipeline);
    assert.equal(pipeline.steps.length, 2);
    assert.equal(pipeline.steps[0].prompt, "implement it");
    assert.equal(pipeline.steps[0].reflect, true);
    assert.equal(pipeline.steps[1].prompt, "test it");
    assert.equal(pipeline.steps[1].reflect, undefined);
  });

  it("handles escaped quotes in prompts", () => {
    const pipeline = parsePipelineArgs('"say \\"hello\\"" "done"');
    assert.ok(pipeline);
    assert.equal(pipeline.steps[0].prompt, 'say "hello"');
  });

  it("returns null for empty input", () => {
    assert.equal(parsePipelineArgs(""), null);
    assert.equal(parsePipelineArgs("   "), null);
  });

  it("returns null for unquoted input", () => {
    assert.equal(parsePipelineArgs("not quoted"), null);
  });

  it("returns null for unclosed quote", () => {
    assert.equal(parsePipelineArgs('"unclosed'), null);
  });

  it("parses single step", () => {
    const pipeline = parsePipelineArgs('"only one"');
    assert.ok(pipeline);
    assert.equal(pipeline.steps.length, 1);
    assert.equal(pipeline.steps[0].prompt, "only one");
  });

  it("parses --reflect on last step", () => {
    const pipeline = parsePipelineArgs('"step one" "step two" --reflect');
    assert.ok(pipeline);
    assert.equal(pipeline.steps.length, 2);
    assert.equal(pipeline.steps[1].reflect, true);
  });
});
