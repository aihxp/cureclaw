import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReflectionPrompt,
  isReflectionPass,
  DEFAULT_REFLECTION_PROMPT,
} from "./reflection.js";

describe("buildReflectionPrompt", () => {
  it("returns default prompt when no custom prompt given", () => {
    assert.equal(buildReflectionPrompt(), DEFAULT_REFLECTION_PROMPT);
  });

  it("returns custom prompt when provided", () => {
    const custom = "Check for security issues.";
    assert.equal(buildReflectionPrompt(custom), custom);
  });
});

describe("isReflectionPass", () => {
  it("detects LGTM (case-insensitive)", () => {
    assert.equal(isReflectionPass("LGTM"), true);
    assert.equal(isReflectionPass("lgtm"), true);
    assert.equal(isReflectionPass("The code looks good. LGTM!"), true);
  });

  it("detects 'looks good to me'", () => {
    assert.equal(isReflectionPass("Everything looks good to me."), true);
  });

  it("detects 'no issues found'", () => {
    assert.equal(isReflectionPass("After review, no issues found."), true);
  });

  it("detects 'everything looks correct'", () => {
    assert.equal(isReflectionPass("Everything looks correct."), true);
  });

  it("returns false for responses describing issues", () => {
    assert.equal(isReflectionPass("I found a bug in the auth module."), false);
    assert.equal(isReflectionPass("There are several problems."), false);
    assert.equal(isReflectionPass("The function has an off-by-one error."), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isReflectionPass(""), false);
  });
});
