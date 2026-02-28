import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSchedule } from "./parse-schedule.js";

describe("parseSchedule", () => {
  describe("at (one-shot)", () => {
    it("parses ISO8601 date", () => {
      const s = parseSchedule("at 2026-03-01T09:00:00Z");
      assert.deepStrictEqual(s, { kind: "at", at: "2026-03-01T09:00:00.000Z" });
    });

    it("throws on invalid date", () => {
      assert.throws(() => parseSchedule("at not-a-date"), /Invalid date/);
    });
  });

  describe("every (interval)", () => {
    it("parses seconds", () => {
      const s = parseSchedule("every 30s");
      assert.deepStrictEqual(s, { kind: "every", everyMs: 30_000 });
    });

    it("parses minutes", () => {
      const s = parseSchedule("every 5m");
      assert.deepStrictEqual(s, { kind: "every", everyMs: 300_000 });
    });

    it("parses hours", () => {
      const s = parseSchedule("every 4h");
      assert.deepStrictEqual(s, { kind: "every", everyMs: 14_400_000 });
    });

    it("parses days", () => {
      const s = parseSchedule("every 1d");
      assert.deepStrictEqual(s, { kind: "every", everyMs: 86_400_000 });
    });

    it("handles whitespace between number and unit", () => {
      const s = parseSchedule("every 30 m");
      assert.deepStrictEqual(s, { kind: "every", everyMs: 1_800_000 });
    });

    it("throws on invalid interval", () => {
      assert.throws(() => parseSchedule("every 5x"), /Invalid interval/);
    });

    it("throws on zero interval", () => {
      assert.throws(() => parseSchedule("every 0m"), /positive/);
    });
  });

  describe("cron", () => {
    it("parses with cron prefix", () => {
      const s = parseSchedule("cron 0 9 * * 1-5");
      assert.deepStrictEqual(s, { kind: "cron", expr: "0 9 * * 1-5" });
    });

    it("parses bare 5-field expression", () => {
      const s = parseSchedule("*/5 * * * *");
      assert.deepStrictEqual(s, { kind: "cron", expr: "*/5 * * * *" });
    });

    it("throws on invalid cron field count", () => {
      assert.throws(() => parseSchedule("cron 0 9 *"), /5 fields/);
    });

    it("throws on invalid cron field syntax", () => {
      assert.throws(() => parseSchedule("cron abc 9 * * *"), /Invalid cron field/);
    });
  });

  describe("unrecognized", () => {
    it("throws on unrecognized format", () => {
      assert.throws(() => parseSchedule("tomorrow"), /Unrecognized schedule/);
    });
  });
});
