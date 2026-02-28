import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildPlugin, sanitizeMcpConfig } from "./build.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-plugin-build-test-${Date.now()}`);
const WORKSPACE = path.join(TEST_DIR, "workspace");
const OUTPUT = path.join(TEST_DIR, "output");

describe("buildPlugin", () => {
  beforeEach(() => {
    fs.mkdirSync(WORKSPACE, { recursive: true });
    fs.mkdirSync(OUTPUT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("builds plugin with rules", () => {
    const rulesDir = path.join(WORKSPACE, ".cursor", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "rule1.md"), "# Rule 1");

    const result = buildPlugin({ workspace: WORKSPACE, outputDir: OUTPUT, name: "test" });

    assert.ok(fs.existsSync(path.join(OUTPUT, "rules", "rule1.md")));
    assert.ok(result.copiedFiles.includes("rules/rule1.md"));
    assert.ok(fs.existsSync(path.join(OUTPUT, ".cursor-plugin", "plugin.json")));
  });

  it("builds plugin with skills", () => {
    const skillDir = path.join(WORKSPACE, ".agents", "skills", "deploy");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Deploy");

    const result = buildPlugin({ workspace: WORKSPACE, outputDir: OUTPUT, name: "test" });

    assert.ok(fs.existsSync(path.join(OUTPUT, "skills", "deploy", "SKILL.md")));
    assert.ok(result.copiedFiles.some((f) => f.includes("SKILL.md")));
  });

  it("sanitizes MCP config env vars", () => {
    const cursorDir = path.join(WORKSPACE, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            env: {
              GITHUB_TOKEN: "secret-value",
              NORMAL_VAR: "keep-this",
            },
          },
        },
      }),
    );

    buildPlugin({ workspace: WORKSPACE, outputDir: OUTPUT, name: "test" });

    const outputMcp = JSON.parse(
      fs.readFileSync(path.join(OUTPUT, ".mcp.json"), "utf-8"),
    );
    assert.strictEqual(
      outputMcp.mcpServers.github.env.GITHUB_TOKEN,
      "YOUR_GITHUB_TOKEN_HERE",
    );
    assert.strictEqual(outputMcp.mcpServers.github.env.NORMAL_VAR, "keep-this");
  });

  it("writes plugin.json manifest", () => {
    const result = buildPlugin({
      workspace: WORKSPACE,
      outputDir: OUTPUT,
      name: "my-plugin",
      version: "1.0.0",
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(OUTPUT, ".cursor-plugin", "plugin.json"), "utf-8"),
    );
    assert.strictEqual(manifest.name, "my-plugin");
    assert.strictEqual(manifest.version, "1.0.0");
    assert.strictEqual(result.manifest.name, "my-plugin");
  });
});

describe("sanitizeMcpConfig", () => {
  it("replaces KEY/TOKEN/SECRET/PASSWORD values", () => {
    const input = JSON.stringify({
      mcpServers: {
        test: {
          command: "cmd",
          env: {
            API_KEY: "abc123",
            AUTH_TOKEN: "xyz",
            DB_SECRET: "s3cret",
            DB_PASSWORD: "pw",
            NORMAL: "keep",
          },
        },
      },
    });

    const result = JSON.parse(sanitizeMcpConfig(input));
    assert.strictEqual(result.mcpServers.test.env.API_KEY, "YOUR_API_KEY_HERE");
    assert.strictEqual(result.mcpServers.test.env.AUTH_TOKEN, "YOUR_AUTH_TOKEN_HERE");
    assert.strictEqual(result.mcpServers.test.env.DB_SECRET, "YOUR_DB_SECRET_HERE");
    assert.strictEqual(result.mcpServers.test.env.DB_PASSWORD, "YOUR_DB_PASSWORD_HERE");
    assert.strictEqual(result.mcpServers.test.env.NORMAL, "keep");
  });

  it("returns original on invalid JSON", () => {
    const result = sanitizeMcpConfig("not json");
    assert.strictEqual(result, "not json");
  });
});
