import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase } from "../db.js";
import { remember, recall, forget, listMemories, formatMemoryList, formatMemoryDetail, buildMemoryContext } from "./memory.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-memory-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("memory", () => {
  describe("remember", () => {
    it("should create a new memory", () => {
      const m = remember("api-key", "Use env var AUTH_TOKEN");
      assert.equal(m.key, "api-key");
      assert.equal(m.content, "Use env var AUTH_TOKEN");
      assert.equal(m.source, "user");
      assert.deepStrictEqual(m.tags, []);
    });

    it("should create a memory with tags", () => {
      const m = remember("deploy", "Run deploy.sh", { tags: ["ops", "prod"] });
      assert.deepStrictEqual(m.tags, ["ops", "prod"]);
    });

    it("should update existing memory by key", () => {
      remember("api-key", "old value");
      const updated = remember("api-key", "new value");
      assert.equal(updated.content, "new value");
      assert.equal(updated.key, "api-key");

      const all = recall("");
      assert.equal(all.length, 1);
    });

    it("should preserve tags on update if not provided", () => {
      remember("deploy", "v1", { tags: ["ops"] });
      const updated = remember("deploy", "v2");
      assert.deepStrictEqual(updated.tags, ["ops"]);
    });
  });

  describe("recall", () => {
    it("should find by key", () => {
      remember("api-key", "AUTH_TOKEN");
      const results = recall("api");
      assert.ok(results.length > 0);
      assert.equal(results[0].key, "api-key");
    });

    it("should find by content", () => {
      remember("server", "Use port 3000");
      const results = recall("port");
      assert.ok(results.length > 0);
      assert.equal(results[0].key, "server");
    });

    it("should return all when query is empty", () => {
      remember("a", "first");
      remember("b", "second");
      const results = recall("");
      assert.equal(results.length, 2);
    });

    it("should return empty for no match", () => {
      remember("a", "first");
      const results = recall("zzzznotfound");
      assert.equal(results.length, 0);
    });
  });

  describe("forget", () => {
    it("should remove a memory by key", () => {
      remember("temp", "temporary data");
      assert.ok(forget("temp"));
      const results = recall("temp");
      assert.equal(results.length, 0);
    });

    it("should return false for nonexistent key", () => {
      assert.equal(forget("nonexistent"), false);
    });
  });

  describe("listMemories", () => {
    it("should filter by tag", () => {
      remember("a", "first", { tags: ["ops"] });
      remember("b", "second", { tags: ["dev"] });
      remember("c", "third", { tags: ["ops", "dev"] });
      const ops = listMemories("ops");
      assert.equal(ops.length, 2);
    });
  });

  describe("formatMemoryList", () => {
    it("should format empty list", () => {
      assert.equal(formatMemoryList([]), "No memories found.");
    });

    it("should format memories", () => {
      remember("api", "token value");
      const all = recall("");
      const text = formatMemoryList(all);
      assert.ok(text.includes("api"));
      assert.ok(text.includes("token value"));
    });
  });

  describe("formatMemoryDetail", () => {
    it("should include all fields", () => {
      const m = remember("api", "token", { tags: ["auth"] });
      const text = formatMemoryDetail(m);
      assert.ok(text.includes("Key: api"));
      assert.ok(text.includes("Content: token"));
      assert.ok(text.includes("Tags: auth"));
      assert.ok(text.includes("Source: user"));
    });
  });

  describe("buildMemoryContext", () => {
    it("should build context from matching memories", () => {
      remember("deploy-cmd", "Run deploy.sh");
      remember("db-url", "postgres://localhost/prod");
      const ctx = buildMemoryContext("deploy");
      assert.ok(ctx.includes("deploy-cmd"));
      assert.ok(ctx.includes("deploy.sh"));
    });

    it("should return no memories message when empty", () => {
      const ctx = buildMemoryContext("nothing");
      assert.ok(ctx.includes("no relevant memories"));
    });
  });
});
