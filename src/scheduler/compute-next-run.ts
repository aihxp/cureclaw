import type { JobSchedule } from "../types.js";

/**
 * Compute the next run time for a given schedule.
 * Returns an ISO string or null (for one-shot "at" schedules that are in the past).
 */
export function computeNextRun(schedule: JobSchedule, now: Date = new Date()): string | null {
  switch (schedule.kind) {
    case "at": {
      const at = new Date(schedule.at);
      return at.getTime() > now.getTime() ? at.toISOString() : null;
    }
    case "every": {
      return new Date(now.getTime() + schedule.everyMs).toISOString();
    }
    case "cron": {
      return nextCronRun(schedule.expr, now);
    }
  }
}

/**
 * Find the next minute matching a 5-field cron expression.
 * Fields: minute hour day-of-month month day-of-week
 * Supports: *, N, N-M, N,M, N/step, *\/step
 *
 * Iterates minute-by-minute, capped at 525960 iterations (1 year).
 */
function nextCronRun(expr: string, now: Date): string | null {
  const fields = expr.split(/\s+/);
  const matchers = fields.map(parseField);

  // Start from the next minute
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const MAX_ITERATIONS = 525_960; // ~1 year of minutes
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const minute = candidate.getMinutes();
    const hour = candidate.getHours();
    const dayOfMonth = candidate.getDate();
    const month = candidate.getMonth() + 1; // 1-12
    const dayOfWeek = candidate.getDay(); // 0=Sun

    if (
      matchers[0](minute) &&
      matchers[1](hour) &&
      matchers[2](dayOfMonth) &&
      matchers[3](month) &&
      matchers[4](dayOfWeek)
    ) {
      return candidate.toISOString();
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

type Matcher = (value: number) => boolean;

function parseField(field: string): Matcher {
  // Handle comma-separated lists
  if (field.includes(",")) {
    const parts = field.split(",");
    const subMatchers = parts.map(parseField);
    return (v) => subMatchers.some((m) => m(v));
  }

  // Handle step: */N or N-M/N
  if (field.includes("/")) {
    const [range, stepStr] = field.split("/");
    const step = parseInt(stepStr, 10);
    if (range === "*") {
      return (v) => v % step === 0;
    }
    const rangeMatcher = parseRange(range);
    return (v) => rangeMatcher(v) && v % step === 0;
  }

  // Handle range: N-M
  if (field.includes("-")) {
    return parseRange(field);
  }

  // Wildcard
  if (field === "*") {
    return () => true;
  }

  // Exact value
  const num = parseInt(field, 10);
  return (v) => v === num;
}

function parseRange(field: string): Matcher {
  const [startStr, endStr] = field.split("-");
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  return (v) => v >= start && v <= end;
}
