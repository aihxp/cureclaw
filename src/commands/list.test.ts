import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseCommandFile, discoverCommands } from "./list.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-commands-list-test-${Date.now()}`);

describe("parseCommandFile", () => {
  it("parses frontmatter and body", () => {
    const content = `---
description: "Review code for issues"
---
Review the following code for potential bugs and style issues.
`;
    const result = parseCommandFile(content);
    assert.strictEqual(result.description, "Review code for issues");
    assert.ok(result.template.includes("Review the following code"));
  });

  it("handles no frontmatter", () => {
    const result = parseCommandFile("Just a prompt template.");
    assert.strictEqual(result.description, "");
    assert.strictEqual(result.template, "Just a prompt template.");
  });

  it("handles empty frontmatter", () => {
    const result = parseCommandFile("---\n---\nTemplate body here.");
    assert.strictEqual(result.description, "");
    assert.strictEqual(result.template, "Template body here.");
  });
});

describe("discoverCommands", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("discovers commands from workspace", () => {
    const cmdDir = path.join(TEST_DIR, ".cursor", "commands");
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(
      path.join(cmdDir, "code-review.md"),
      '---\ndescription: "Code review"\n---\nReview the code.',
    );

    const commands = discoverCommands(TEST_DIR);
    assert.strictEqual(commands.length, 1);
    assert.strictEqual(commands[0].name, "code-review");
    assert.strictEqual(commands[0].source, "workspace");
  });

  it("returns empty for no commands dir", () => {
    const commands = discoverCommands(TEST_DIR);
    assert.strictEqual(commands.length, 0);
  });

  it("skips non-.md files", () => {
    const cmdDir = path.join(TEST_DIR, ".cursor", "commands");
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, "readme.txt"), "not a command");

    const commands = discoverCommands(TEST_DIR);
    assert.strictEqual(commands.length, 0);
  });
});
