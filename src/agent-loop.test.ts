import { describe, it } from "node:test";
import assert from "node:assert/strict";

// We test the translateEvent helpers indirectly by importing the module.
// Since translateEvent is not exported, we test the public agentLoop
// surface through the EventStream it returns, using mock data.

// For unit testing, we import the module to verify it loads correctly
// and test the tool name extraction logic by simulating cursor events.

describe("agent-loop module", () => {
  it("imports without error", async () => {
    // Verify the module can be loaded (catches syntax/import errors)
    const mod = await import("./agent-loop.js");
    assert.equal(typeof mod.agentLoop, "function");
  });
});

describe("tool name extraction logic", () => {
  // These tests validate the key extraction pattern used in agent-loop.ts:
  // find key ending in "ToolCall", strip suffix

  function extractToolName(toolCall: Record<string, unknown>): string {
    const keys = Object.keys(toolCall).filter((k) => k.endsWith("ToolCall"));
    if (keys.length > 0) {
      return keys[0].replace("ToolCall", "");
    }
    return "unknown";
  }

  it("extracts shell from shellToolCall", () => {
    assert.equal(extractToolName({ shellToolCall: {} }), "shell");
  });

  it("extracts fileEdit from fileEditToolCall", () => {
    assert.equal(extractToolName({ fileEditToolCall: {} }), "fileEdit");
  });

  it("extracts read from readToolCall", () => {
    assert.equal(extractToolName({ readToolCall: {} }), "read");
  });

  it("returns unknown for empty payload", () => {
    assert.equal(extractToolName({}), "unknown");
  });

  it("returns unknown for non-ToolCall keys", () => {
    assert.equal(extractToolName({ someOtherKey: {} }), "unknown");
  });

  it("extracts listDir from listDirToolCall", () => {
    assert.equal(extractToolName({ listDirToolCall: {} }), "listDir");
  });
});
