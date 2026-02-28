import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeNextRun } from "./compute-next-run.js";

describe("computeNextRun", () => {
  const now = new Date("2026-03-01T12:00:00Z");

  describe("at (one-shot)", () => {
    it("returns date if in the future", () => {
      const result = computeNextRun({ kind: "at", at: "2026-03-02T09:00:00Z" }, now);
      assert.strictEqual(result, "2026-03-02T09:00:00.000Z");
    });

    it("returns null if in the past", () => {
      const result = computeNextRun({ kind: "at", at: "2026-02-28T09:00:00Z" }, now);
      assert.strictEqual(result, null);
    });
  });

  describe("every (interval)", () => {
    it("returns now + interval", () => {
      const result = computeNextRun({ kind: "every", everyMs: 3_600_000 }, now);
      assert.strictEqual(result, "2026-03-01T13:00:00.000Z");
    });

    it("works with small intervals", () => {
      const result = computeNextRun({ kind: "every", everyMs: 60_000 }, now);
      assert.strictEqual(result, "2026-03-01T12:01:00.000Z");
    });
  });

  describe("cron", () => {
    it("finds next matching minute for every-5-minutes", () => {
      const result = computeNextRun({ kind: "cron", expr: "*/5 * * * *" }, now);
      // now is 12:00, next match at :05 of the next minute check: 12:05
      assert.ok(result !== null);
      const d = new Date(result!);
      assert.strictEqual(d.getMinutes() % 5, 0);
      assert.ok(d.getTime() > now.getTime());
    });

    it("finds next weekday 9am for cron 0 9 * * 1-5", () => {
      // Cron matching uses local time, so assert with local getters
      const result = computeNextRun({ kind: "cron", expr: "0 9 * * 1-5" }, now);
      assert.ok(result !== null);
      const d = new Date(result!);
      assert.strictEqual(d.getHours(), 9);
      assert.strictEqual(d.getMinutes(), 0);
      // Day should be a weekday (1-5)
      assert.ok(d.getDay() >= 1 && d.getDay() <= 5, `Expected weekday, got day ${d.getDay()}`);
    });

    it("returns null for impossible cron (month 13)", () => {
      // Month field 13 can never match (months are 1-12)
      const result = computeNextRun({ kind: "cron", expr: "0 0 1 13 *" }, now);
      assert.strictEqual(result, null);
    });
  });
});
