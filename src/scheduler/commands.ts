import { addJob, getAllJobs, findJobByIdPrefix, removeJob } from "../db.js";
import type { DeliveryTarget, Job } from "../types.js";
import { parseSchedule } from "./parse-schedule.js";
import { computeNextRun } from "./compute-next-run.js";

export interface CommandContext {
  /** Channel type for delivery (e.g., "telegram", "whatsapp", "cli") */
  channelType: string;
  /** Channel-specific ID (e.g., chatId, JID, "cli") */
  channelId: string;
}

export interface CommandResult {
  text: string;
}

/**
 * Handle /schedule, /jobs, /cancel commands.
 * Returns a CommandResult if the input matched a scheduler command, null otherwise.
 */
export function handleSchedulerCommand(input: string, ctx: CommandContext): CommandResult | null {
  const trimmed = input.trim();

  if (trimmed === "/jobs") {
    return handleJobs();
  }

  if (trimmed.startsWith("/cancel ")) {
    return handleCancel(trimmed.slice(8).trim());
  }

  if (trimmed.startsWith("/schedule ")) {
    return handleSchedule(trimmed.slice(10).trim(), ctx);
  }

  return null;
}

function handleSchedule(args: string, ctx: CommandContext): CommandResult {
  // Parse: "prompt" <schedule> [--cloud] [--repo <url>]
  // The prompt is in quotes, schedule follows
  const match = args.match(/^"((?:[^"\\]|\\.)*)"\s+(.+)$/);
  if (!match) {
    return {
      text: 'Usage: /schedule "prompt" <schedule> [--cloud] [--repo <url>]\n\nSchedule formats:\n  every <N><s|m|h|d>    e.g., every 30m, every 4h\n  at <ISO8601>          e.g., at 2026-03-01T09:00:00Z\n  cron <5-field>        e.g., cron 0 9 * * 1-5',
    };
  }

  const prompt = match[1].replace(/\\"/g, '"');
  let scheduleStr = match[2].trim();
  let cloud = false;
  let repository: string | undefined;

  // Extract --repo flag
  const repoMatch = scheduleStr.match(/--repo\s+(\S+)/);
  if (repoMatch) {
    repository = repoMatch[1];
    scheduleStr = scheduleStr.replace(/--repo\s+\S+/, "").trim();
  }

  if (scheduleStr.endsWith("--cloud")) {
    cloud = true;
    scheduleStr = scheduleStr.slice(0, -7).trim();
  }

  let schedule;
  try {
    schedule = parseSchedule(scheduleStr);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Schedule error: ${msg}` };
  }

  const now = new Date();
  const nextRunAt = computeNextRun(schedule, now);

  if (!nextRunAt) {
    return { text: "Schedule date is in the past." };
  }

  const delivery: DeliveryTarget =
    ctx.channelType === "cli"
      ? { kind: "store" }
      : { kind: "channel", channelType: ctx.channelType, channelId: ctx.channelId };

  const name = prompt.length > 40 ? prompt.slice(0, 37) + "..." : prompt;

  const job = addJob({
    name,
    prompt,
    schedule,
    delivery,
    cloud,
    repository,
    enabled: true,
    createdAt: now.toISOString(),
    nextRunAt,
  });

  return {
    text: `Job ${job.id} created.\nSchedule: ${formatSchedule(job.schedule)}\nNext run: ${formatDate(job.nextRunAt)}\nDelivery: ${formatDelivery(job.delivery)}${cloud ? "\nMode: cloud" : ""}${repository ? `\nRepo: ${repository}` : ""}`,
  };
}

function handleJobs(): CommandResult {
  const jobs = getAllJobs();
  if (jobs.length === 0) {
    return { text: "No scheduled jobs." };
  }

  const lines = ["Scheduled jobs:\n"];
  for (const job of jobs) {
    const status = job.enabled ? "on" : "off";
    const lastInfo = job.lastStatus
      ? ` | last: ${job.lastStatus}${job.lastRunAt ? " " + formatDate(job.lastRunAt) : ""}`
      : "";
    const errInfo = job.consecutiveErrors > 0 ? ` | errors: ${job.consecutiveErrors}` : "";
    lines.push(
      `  ${job.id}  [${status}]  ${formatSchedule(job.schedule)}  "${job.name}"`,
    );
    lines.push(
      `         next: ${formatDate(job.nextRunAt)}${lastInfo}${errInfo}`,
    );
  }

  return { text: lines.join("\n") };
}

function handleCancel(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /cancel <id-prefix>" };
  }

  const job = findJobByIdPrefix(idPrefix);
  if (!job) {
    return { text: `No job found matching "${idPrefix}".` };
  }

  removeJob(job.id);
  return { text: `Job ${job.id} ("${job.name}") removed.` };
}

function formatSchedule(s: Job["schedule"]): string {
  switch (s.kind) {
    case "at":
      return `at ${s.at}`;
    case "every": {
      const ms = s.everyMs;
      if (ms >= 86_400_000) return `every ${ms / 86_400_000}d`;
      if (ms >= 3_600_000) return `every ${ms / 3_600_000}h`;
      if (ms >= 60_000) return `every ${ms / 60_000}m`;
      return `every ${ms / 1_000}s`;
    }
    case "cron":
      return `cron ${s.expr}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDelivery(d: DeliveryTarget): string {
  if (d.kind === "store") return "store only";
  return `${d.channelType}:${d.channelId}`;
}
