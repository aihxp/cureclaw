import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase } from "../db.js";
import { handleReviewCommand } from "./commands.js";
import { REVIEWER_PERSONAS, getPersonaByName, getPersonaNames } from "./personas.js";

let tmpDir: string;
const ctx = { channelType: "cli", channelId: "cli" };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-rev-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleReviewCommand", () => {
  it("should return null for non-review commands", () => {
    assert.equal(handleReviewCommand("/help"), null);
    assert.equal(handleReviewCommand("/jobs"), null);
  });

  it("should show help for /review", () => {
    const result = handleReviewCommand("/review");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("/review"));
    assert.ok(text.includes("personas"));
  });

  it("should show help for /review help", () => {
    const result = handleReviewCommand("/review help");
    assert.ok(result);
    assert.ok(!("then" in result));
    const text = (result as { text: string }).text;
    assert.ok(text.includes("--post"));
    assert.ok(text.includes("--models"));
  });

  it("should require config for review", async () => {
    const result = handleReviewCommand("/review main", ctx);
    assert.ok(result);
    const resolved = result instanceof Promise ? await result : result;
    assert.ok(resolved.text.includes("cursor configuration not available") || resolved.text.includes("Error"));
  });

  it("should return null for /revi (partial match)", () => {
    assert.equal(handleReviewCommand("/revi"), null);
  });
});

describe("reviewer personas", () => {
  it("should have 3 built-in personas", () => {
    assert.equal(REVIEWER_PERSONAS.length, 3);
  });

  it("should have security persona", () => {
    const persona = getPersonaByName("security");
    assert.ok(persona);
    assert.equal(persona.name, "security");
    assert.ok(persona.systemPrompt.includes("security"));
  });

  it("should have architecture persona", () => {
    const persona = getPersonaByName("architecture");
    assert.ok(persona);
    assert.equal(persona.name, "architecture");
    assert.ok(persona.systemPrompt.includes("architecture"));
  });

  it("should have performance persona", () => {
    const persona = getPersonaByName("performance");
    assert.ok(persona);
    assert.equal(persona.name, "performance");
    assert.ok(persona.systemPrompt.includes("performance"));
  });

  it("should return undefined for non-existent persona", () => {
    assert.equal(getPersonaByName("nonexistent"), undefined);
  });

  it("should list all persona names", () => {
    const names = getPersonaNames();
    assert.equal(names.length, 3);
    assert.ok(names.includes("security"));
    assert.ok(names.includes("architecture"));
    assert.ok(names.includes("performance"));
  });
});
