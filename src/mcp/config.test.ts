import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readMcpConfig,
  writeMcpConfig,
  addMcpServer,
  removeMcpServer,
  listMcpServers,
} from "./config.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-mcp-test-${Date.now()}`);

describe("MCP config", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty config when file does not exist", () => {
    const config = readMcpConfig(TEST_DIR);
    assert.deepStrictEqual(config, { mcpServers: {} });
  });

  it("reads existing config", () => {
    const cursorDir = path.join(TEST_DIR, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "@mcp/server-github"] },
        },
      }),
    );

    const config = readMcpConfig(TEST_DIR);
    assert.strictEqual(Object.keys(config.mcpServers).length, 1);
    assert.strictEqual(config.mcpServers.github.command, "npx");
  });

  it("writes config and creates .cursor/ dir", () => {
    writeMcpConfig(TEST_DIR, {
      mcpServers: {
        test: { command: "echo", args: ["hello"] },
      },
    });

    const filePath = path.join(TEST_DIR, ".cursor", "mcp.json");
    assert.ok(fs.existsSync(filePath));

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.strictEqual(content.mcpServers.test.command, "echo");
  });

  it("adds a server", () => {
    addMcpServer(TEST_DIR, "github", {
      command: "npx",
      args: ["-y", "@mcp/server-github"],
    });

    const servers = listMcpServers(TEST_DIR);
    assert.strictEqual(servers.length, 1);
    assert.strictEqual(servers[0].name, "github");
  });

  it("rejects duplicate server name", () => {
    addMcpServer(TEST_DIR, "github", { command: "npx" });
    assert.throws(
      () => addMcpServer(TEST_DIR, "github", { command: "other" }),
      /already exists/,
    );
  });

  it("removes a server", () => {
    addMcpServer(TEST_DIR, "github", { command: "npx" });
    const removed = removeMcpServer(TEST_DIR, "github");
    assert.strictEqual(removed, true);
    assert.strictEqual(listMcpServers(TEST_DIR).length, 0);
  });

  it("returns false when removing non-existent server", () => {
    const removed = removeMcpServer(TEST_DIR, "nonexistent");
    assert.strictEqual(removed, false);
  });

  it("lists all servers", () => {
    addMcpServer(TEST_DIR, "a", { command: "cmd-a" });
    addMcpServer(TEST_DIR, "b", { command: "cmd-b", args: ["arg1"] });

    const servers = listMcpServers(TEST_DIR);
    assert.strictEqual(servers.length, 2);
    const names = servers.map((s) => s.name);
    assert.ok(names.includes("a"));
    assert.ok(names.includes("b"));
  });
});
