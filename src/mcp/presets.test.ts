import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, findPreset, listPresets, getCategories, formatPresetList, checkPresetEnv } from "./presets.js";

describe("MCP presets", () => {
  describe("findPreset", () => {
    it("should find by exact name", () => {
      const p = findPreset("github");
      assert.ok(p);
      assert.equal(p.name, "github");
    });

    it("should find case-insensitive", () => {
      const p = findPreset("GitHub");
      assert.ok(p);
      assert.equal(p.name, "github");
    });

    it("should return undefined for unknown", () => {
      assert.equal(findPreset("nonexistent"), undefined);
    });
  });

  describe("listPresets", () => {
    it("should list all presets", () => {
      const all = listPresets();
      assert.equal(all.length, PRESETS.length);
    });

    it("should filter by category", () => {
      const devTools = listPresets("dev-tools");
      assert.ok(devTools.length > 0);
      assert.ok(devTools.every((p) => p.category === "dev-tools"));
    });

    it("should return empty for unknown category", () => {
      const result = listPresets("nonexistent");
      assert.equal(result.length, 0);
    });
  });

  describe("getCategories", () => {
    it("should return unique categories", () => {
      const cats = getCategories();
      assert.ok(cats.length > 0);
      assert.equal(cats.length, new Set(cats).size);
    });
  });

  describe("formatPresetList", () => {
    it("should format presets with categories", () => {
      const text = formatPresetList(PRESETS);
      assert.ok(text.includes("MCP Presets:"));
      assert.ok(text.includes("github"));
      assert.ok(text.includes("/mcp install"));
    });

    it("should handle empty list", () => {
      const text = formatPresetList([]);
      assert.equal(text, "No presets found.");
    });
  });

  describe("checkPresetEnv", () => {
    it("should report ready for no env vars", () => {
      const preset = findPreset("filesystem")!;
      const result = checkPresetEnv(preset);
      assert.equal(result.ready, true);
      assert.equal(result.missing.length, 0);
    });

    it("should report missing env vars", () => {
      const preset = findPreset("github")!;
      // This env var is unlikely to be set in test environment
      delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
      const result = checkPresetEnv(preset);
      assert.equal(result.ready, false);
      assert.ok(result.missing.includes("GITHUB_PERSONAL_ACCESS_TOKEN"));
    });
  });
});
