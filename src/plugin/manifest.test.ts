import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateManifest } from "./manifest.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-plugin-manifest-test-${Date.now()}`);

describe("generateManifest", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("generates minimal manifest for empty workspace", () => {
    const manifest = generateManifest({ name: "test", workspace: TEST_DIR });
    assert.strictEqual(manifest.name, "test");
    assert.strictEqual(manifest.rules, undefined);
    assert.strictEqual(manifest.skills, undefined);
    assert.strictEqual(manifest.agents, undefined);
    assert.strictEqual(manifest.mcpServers, undefined);
  });

  it("includes description and version", () => {
    const manifest = generateManifest({
      name: "test",
      description: "A test plugin",
      version: "1.0.0",
      workspace: TEST_DIR,
    });
    assert.strictEqual(manifest.description, "A test plugin");
    assert.strictEqual(manifest.version, "1.0.0");
  });

  it("detects .cursor/rules/", () => {
    const rulesDir = path.join(TEST_DIR, ".cursor", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "rule1.md"), "# Rule 1");

    const manifest = generateManifest({ name: "test", workspace: TEST_DIR });
    assert.strictEqual(manifest.rules, "rules/");
  });

  it("detects .agents/skills/", () => {
    const skillsDir = path.join(TEST_DIR, ".agents", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "deploy"), "skill");

    const manifest = generateManifest({ name: "test", workspace: TEST_DIR });
    assert.strictEqual(manifest.skills, "skills/");
  });

  it("detects .cursor/agents/", () => {
    const agentsDir = path.join(TEST_DIR, ".cursor", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "agent1.md"), "agent");

    const manifest = generateManifest({ name: "test", workspace: TEST_DIR });
    assert.strictEqual(manifest.agents, "agents/");
  });

  it("detects .cursor/mcp.json", () => {
    const cursorDir = path.join(TEST_DIR, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, "mcp.json"), '{"mcpServers":{}}');

    const manifest = generateManifest({ name: "test", workspace: TEST_DIR });
    assert.strictEqual(manifest.mcpServers, ".mcp.json");
  });

  it("skips empty rules directory", () => {
    const rulesDir = path.join(TEST_DIR, ".cursor", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });

    const manifest = generateManifest({ name: "test", workspace: TEST_DIR });
    assert.strictEqual(manifest.rules, undefined);
  });
});
