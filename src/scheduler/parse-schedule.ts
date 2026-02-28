import type { JobSchedule } from "../types.js";

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a schedule string into a JobSchedule.
 *
 * Formats:
 *   "at 2026-03-01T09:00:00Z"       → { kind: "at", at: "..." }
 *   "every 4h"                       → { kind: "every", everyMs: 14400000 }
 *   "every 30m"                      → { kind: "every", everyMs: 1800000 }
 *   "cron 0 9 * * 1-5"              → { kind: "cron", expr: "0 9 * * 1-5" }
 *   "0 9 * * 1-5"                   → { kind: "cron", expr: "0 9 * * 1-5" } (bare 5-field)
 */
export function parseSchedule(input: string): JobSchedule {
  const trimmed = input.trim();

  // "at <ISO8601>"
  if (trimmed.startsWith("at ")) {
    const dateStr = trimmed.slice(3).trim();
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date: ${dateStr}`);
    }
    return { kind: "at", at: d.toISOString() };
  }

  // "every <N><unit>"
  if (trimmed.startsWith("every ")) {
    const spec = trimmed.slice(6).trim();
    const match = spec.match(/^(\d+)\s*([smhd])$/);
    if (!match) {
      throw new Error(`Invalid interval: "${spec}". Use <N><s|m|h|d> (e.g., "30m", "4h").`);
    }
    const n = parseInt(match[1], 10);
    const unit = match[2];
    if (n <= 0) {
      throw new Error("Interval must be positive.");
    }
    return { kind: "every", everyMs: n * UNIT_MS[unit] };
  }

  // "cron <5-field>"
  if (trimmed.startsWith("cron ")) {
    const expr = trimmed.slice(5).trim();
    validateCronExpr(expr);
    return { kind: "cron", expr };
  }

  // Bare 5-field cron (e.g., "0 9 * * 1-5")
  const fields = trimmed.split(/\s+/);
  if (fields.length === 5) {
    validateCronExpr(trimmed);
    return { kind: "cron", expr: trimmed };
  }

  throw new Error(
    `Unrecognized schedule: "${trimmed}". Use "at <date>", "every <N><s|m|h|d>", or "cron <5-field>".`,
  );
}

function validateCronExpr(expr: string): void {
  const fields = expr.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${fields.length}: "${expr}"`);
  }
  // Basic validation: each field should match cron-like patterns
  const fieldPattern = /^(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/;
  for (const field of fields) {
    if (!fieldPattern.test(field)) {
      throw new Error(`Invalid cron field: "${field}" in "${expr}"`);
    }
  }
}
