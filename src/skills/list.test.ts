import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverSkills, parseSkillFrontmatter } from "./list.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-skills-list-test-${Date.now()}`);

describe("parseSkillFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const content = `---
name: deploy
description: "Deploy to prod"
---
# deploy`;
    const result = parseSkillFrontmatter(content);
    assert.deepStrictEqual(result, { name: "deploy", description: "Deploy to prod" });
  });

  it("parses frontmatter without quotes on description", () => {
    const content = `---
name: test
description: A test skill
---`;
    const result = parseSkillFrontmatter(content);
    assert.deepStrictEqual(result, { name: "test", description: "A test skill" });
  });

  it("returns null for content without frontmatter", () => {
    assert.strictEqual(parseSkillFrontmatter("# Just a heading"), null);
  });

  it("returns null for frontmatter without name", () => {
    const content = `---
description: "test"
---`;
    assert.strictEqual(parseSkillFrontmatter(content), null);
  });

  it("handles missing description", () => {
    const content = `---
name: minimal
---`;
    const result = parseSkillFrontmatter(content);
    assert.deepStrictEqual(result, { name: "minimal", description: "" });
  });
});

describe("discoverSkills", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("discovers skills from .agents/skills/", () => {
    const skillDir = path.join(TEST_DIR, ".agents", "skills", "deploy");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      '---\nname: deploy\ndescription: "Deploy"\n---\n',
    );

    const skills = discoverSkills(TEST_DIR);
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].name, "deploy");
    assert.strictEqual(skills[0].source, "workspace");
  });

  it("discovers skills from .cursor/skills/", () => {
    const skillDir = path.join(TEST_DIR, ".cursor", "skills", "lint");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      '---\nname: lint\ndescription: "Lint code"\n---\n',
    );

    const skills = discoverSkills(TEST_DIR);
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].name, "lint");
    assert.strictEqual(skills[0].source, "project");
  });

  it("deduplicates by name (workspace wins)", () => {
    const wsDir = path.join(TEST_DIR, ".agents", "skills", "deploy");
    const projDir = path.join(TEST_DIR, ".cursor", "skills", "deploy");
    fs.mkdirSync(wsDir, { recursive: true });
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, "SKILL.md"),
      '---\nname: deploy\ndescription: "WS"\n---\n',
    );
    fs.writeFileSync(
      path.join(projDir, "SKILL.md"),
      '---\nname: deploy\ndescription: "Proj"\n---\n',
    );

    const skills = discoverSkills(TEST_DIR);
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].source, "workspace");
    assert.strictEqual(skills[0].description, "WS");
  });

  it("skips dirs without SKILL.md", () => {
    const skillDir = path.join(TEST_DIR, ".agents", "skills", "empty");
    fs.mkdirSync(skillDir, { recursive: true });

    const skills = discoverSkills(TEST_DIR);
    assert.strictEqual(skills.length, 0);
  });

  it("returns empty array for missing workspace", () => {
    const skills = discoverSkills(path.join(TEST_DIR, "nonexistent"));
    assert.strictEqual(skills.length, 0);
  });
});
