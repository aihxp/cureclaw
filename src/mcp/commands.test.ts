import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleMcpCommand } from "./commands.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-mcp-cmd-test-${Date.now()}`);

describe("MCP commands", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-MCP commands", () => {
    assert.strictEqual(handleMcpCommand("/help", TEST_DIR), null);
    assert.strictEqual(handleMcpCommand("hello", TEST_DIR), null);
  });

  it("returns help for /mcp", () => {
    const result = handleMcpCommand("/mcp", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("MCP commands"));
  });

  it("lists empty servers", () => {
    const result = handleMcpCommand("/mcp list", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("No MCP servers"));
  });

  it("adds a server", () => {
    const result = handleMcpCommand("/mcp add github npx -y @mcp/server-github", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("added"));
  });

  it("lists added servers", () => {
    handleMcpCommand("/mcp add github npx -y @mcp/server-github", TEST_DIR);
    const result = handleMcpCommand("/mcp list", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("github"));
    assert.ok(result.text.includes("npx"));
  });

  it("removes a server", () => {
    handleMcpCommand("/mcp add github npx", TEST_DIR);
    const result = handleMcpCommand("/mcp remove github", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("removed"));
  });

  it("reports not found on remove", () => {
    const result = handleMcpCommand("/mcp remove nonexistent", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("not found"));
  });

  it("returns usage for /mcp add with insufficient args", () => {
    const result = handleMcpCommand("/mcp add", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("Usage"));
  });

  it("rejects duplicate add", () => {
    handleMcpCommand("/mcp add github npx", TEST_DIR);
    const result = handleMcpCommand("/mcp add github other", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("already exists"));
  });

  it("returns error for unknown subcommand", () => {
    const result = handleMcpCommand("/mcp foobar", TEST_DIR);
    assert.ok(result);
    assert.ok(result.text.includes("Unknown"));
  });
});
