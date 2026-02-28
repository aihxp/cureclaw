import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scaffoldSkill, validateSkillName } from "./scaffold.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-skills-test-${Date.now()}`);

describe("validateSkillName", () => {
  it("accepts valid lowercase names", () => {
    assert.strictEqual(validateSkillName("deploy"), null);
    assert.strictEqual(validateSkillName("my-skill"), null);
    assert.strictEqual(validateSkillName("a"), null);
    assert.strictEqual(validateSkillName("skill123"), null);
  });

  it("rejects empty name", () => {
    assert.ok(validateSkillName(""));
  });

  it("rejects uppercase", () => {
    assert.ok(validateSkillName("Deploy"));
  });

  it("rejects leading hyphen", () => {
    assert.ok(validateSkillName("-skill"));
  });

  it("rejects trailing hyphen", () => {
    assert.ok(validateSkillName("skill-"));
  });

  it("rejects names over 64 chars", () => {
    assert.ok(validateSkillName("a".repeat(65)));
  });

  it("rejects special characters", () => {
    assert.ok(validateSkillName("my_skill"));
    assert.ok(validateSkillName("my.skill"));
  });
});

describe("scaffoldSkill", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates skill directory structure", () => {
    const skillDir = scaffoldSkill({ name: "deploy", baseDir: TEST_DIR });

    assert.strictEqual(skillDir, path.join(TEST_DIR, "deploy"));
    assert.ok(fs.existsSync(path.join(skillDir, "SKILL.md")));
    assert.ok(fs.existsSync(path.join(skillDir, "scripts")));
    assert.ok(fs.existsSync(path.join(skillDir, "references")));
  });

  it("writes correct SKILL.md template", () => {
    scaffoldSkill({
      name: "deploy",
      description: "Deploy to production",
      baseDir: TEST_DIR,
    });

    const content = fs.readFileSync(path.join(TEST_DIR, "deploy", "SKILL.md"), "utf-8");
    assert.ok(content.includes("name: deploy"));
    assert.ok(content.includes('description: "Deploy to production"'));
    assert.ok(content.includes("# deploy"));
    assert.ok(content.includes("## Instructions"));
  });

  it("uses default description", () => {
    scaffoldSkill({ name: "test", baseDir: TEST_DIR });

    const content = fs.readFileSync(path.join(TEST_DIR, "test", "SKILL.md"), "utf-8");
    assert.ok(content.includes("A CureClaw skill"));
  });

  it("throws on duplicate skill", () => {
    scaffoldSkill({ name: "deploy", baseDir: TEST_DIR });
    assert.throws(
      () => scaffoldSkill({ name: "deploy", baseDir: TEST_DIR }),
      /already exists/,
    );
  });

  it("throws on invalid name", () => {
    assert.throws(
      () => scaffoldSkill({ name: "Bad-Name", baseDir: TEST_DIR }),
      /lowercase/,
    );
  });
});
