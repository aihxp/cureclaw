import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidMode, parseModePrefix } from "./mode.js";

describe("isValidMode", () => {
  it("accepts agent", () => {
    assert.strictEqual(isValidMode("agent"), true);
  });

  it("accepts plan", () => {
    assert.strictEqual(isValidMode("plan"), true);
  });

  it("accepts ask", () => {
    assert.strictEqual(isValidMode("ask"), true);
  });

  it("rejects invalid mode", () => {
    assert.strictEqual(isValidMode("edit"), false);
    assert.strictEqual(isValidMode(""), false);
  });
});

describe("parseModePrefix", () => {
  it("parses ? prefix as ask mode", () => {
    const result = parseModePrefix("?what does this do");
    assert.deepStrictEqual(result, { mode: "ask", prompt: "what does this do" });
  });

  it("parses ! prefix as plan mode", () => {
    const result = parseModePrefix("!plan a refactor");
    assert.deepStrictEqual(result, { mode: "plan", prompt: "plan a refactor" });
  });

  it("returns null for non-prefix text", () => {
    assert.strictEqual(parseModePrefix("hello world"), null);
    assert.strictEqual(parseModePrefix("?"), null);
    assert.strictEqual(parseModePrefix("!"), null);
  });
});
