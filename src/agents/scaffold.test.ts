import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateAgentName, scaffoldAgent } from "./scaffold.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-agents-scaffold-test-${Date.now()}`);

describe("validateAgentName", () => {
  it("accepts valid names", () => {
    assert.strictEqual(validateAgentName("reviewer"), null);
    assert.strictEqual(validateAgentName("code-review"), null);
    assert.strictEqual(validateAgentName("a"), null);
  });

  it("rejects empty name", () => {
    assert.ok(validateAgentName(""));
  });

  it("rejects invalid characters", () => {
    assert.ok(validateAgentName("My Agent"));
    assert.ok(validateAgentName("-bad"));
  });
});

describe("scaffoldAgent", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates agent file", () => {
    const filePath = scaffoldAgent({
      name: "reviewer",
      description: "Code review agent",
      readonly: true,
      baseDir: TEST_DIR,
    });

    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.ok(content.includes("name: reviewer"));
    assert.ok(content.includes("readonly: true"));
  });

  it("throws on duplicate", () => {
    scaffoldAgent({ name: "reviewer", baseDir: TEST_DIR });
    assert.throws(
      () => scaffoldAgent({ name: "reviewer", baseDir: TEST_DIR }),
      /already exists/,
    );
  });

  it("throws on invalid name", () => {
    assert.throws(
      () => scaffoldAgent({ name: "-bad", baseDir: TEST_DIR }),
      /lowercase/,
    );
  });

  it("uses defaults", () => {
    const filePath = scaffoldAgent({ name: "helper", baseDir: TEST_DIR });
    const content = fs.readFileSync(filePath, "utf-8");
    assert.ok(content.includes("model: inherit"));
    assert.ok(content.includes("readonly: false"));
  });
});
