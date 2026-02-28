import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseAgentFrontmatter, discoverAgents } from "./list.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-agents-list-test-${Date.now()}`);

describe("parseAgentFrontmatter", () => {
  it("parses name and description", () => {
    const content = `---
name: Reviewer
description: "Code review agent"
model: inherit
readonly: true
is_background: false
---
# Reviewer

Review code for issues.
`;
    const result = parseAgentFrontmatter(content);
    assert.ok(result);
    assert.strictEqual(result.name, "Reviewer");
    assert.strictEqual(result.description, "Code review agent");
    assert.strictEqual(result.model, "inherit");
    assert.strictEqual(result.readonly, true);
    assert.strictEqual(result.isBackground, false);
  });

  it("returns null for no frontmatter", () => {
    assert.strictEqual(parseAgentFrontmatter("# Just markdown"), null);
  });

  it("returns null for missing name", () => {
    const result = parseAgentFrontmatter("---\ndescription: test\n---");
    assert.strictEqual(result, null);
  });
});

describe("discoverAgents", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("discovers agents from workspace", () => {
    const agentsDir = path.join(TEST_DIR, ".cursor", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "reviewer.md"),
      '---\nname: Reviewer\ndescription: "Reviews code"\n---\n# Reviewer',
    );

    const agents = discoverAgents(TEST_DIR);
    assert.strictEqual(agents.length, 1);
    assert.strictEqual(agents[0].name, "Reviewer");
    assert.strictEqual(agents[0].slug, "reviewer");
    assert.strictEqual(agents[0].source, "workspace");
  });

  it("skips files without frontmatter", () => {
    const agentsDir = path.join(TEST_DIR, ".cursor", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "bad.md"), "# No frontmatter");

    const agents = discoverAgents(TEST_DIR);
    assert.strictEqual(agents.length, 0);
  });
});
