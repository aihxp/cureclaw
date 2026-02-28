import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Job, JobSchedule, DeliveryTarget } from "./types.js";

let db: Database.Database;

const DEFAULT_DATA_DIR = path.join(os.homedir(), ".cureclaw");

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      cwd TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      last_prompt TEXT,
      last_result TEXT,
      model TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cwd TEXT NOT NULL,
      session_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      result TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_cwd ON history(cwd, created_at);
    CREATE INDEX IF NOT EXISTS idx_history_session ON history(session_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_kind TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      delivery_kind TEXT NOT NULL,
      delivery_channel_type TEXT,
      delivery_channel_id TEXT,
      cloud INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      next_run_at TEXT,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      last_result TEXT,
      consecutive_errors INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs(enabled, next_run_at);
  `);
}

export function initDatabase(dataDir?: string): void {
  const dir = dataDir || process.env.CURECLAW_DATA_DIR || DEFAULT_DATA_DIR;
  const dbPath = path.join(dir, "store.db");
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  createSchema(db);
}

export function closeDatabase(): void {
  if (db) db.close();
}

// --- Session accessors ---

export interface SessionRow {
  cwd: string;
  session_id: string;
  last_prompt: string | null;
  last_result: string | null;
  model: string | null;
  updated_at: string;
}

export function getSession(cwd: string): SessionRow | undefined {
  return db
    .prepare("SELECT * FROM sessions WHERE cwd = ?")
    .get(cwd) as SessionRow | undefined;
}

export function setSession(
  cwd: string,
  sessionId: string,
  opts?: { lastPrompt?: string; lastResult?: string; model?: string },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (cwd, session_id, last_prompt, last_result, model, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cwd) DO UPDATE SET
       session_id = excluded.session_id,
       last_prompt = COALESCE(excluded.last_prompt, last_prompt),
       last_result = COALESCE(excluded.last_result, last_result),
       model = COALESCE(excluded.model, model),
       updated_at = excluded.updated_at`,
  ).run(
    cwd,
    sessionId,
    opts?.lastPrompt ?? null,
    opts?.lastResult ?? null,
    opts?.model ?? null,
    now,
  );
}

export function clearSession(cwd: string): void {
  db.prepare("DELETE FROM sessions WHERE cwd = ?").run(cwd);
}

export function getAllSessions(): SessionRow[] {
  return db
    .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
    .all() as SessionRow[];
}

// --- Config accessors ---

export function getConfig(key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM config WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
  ).run(key, value);
}

// --- History accessors ---

export interface HistoryEntry {
  id?: number;
  cwd: string;
  session_id: string;
  prompt: string;
  result?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  duration_ms?: number | null;
  created_at: string;
}

export function addHistory(entry: HistoryEntry): void {
  db.prepare(
    `INSERT INTO history (cwd, session_id, prompt, result, model, input_tokens, output_tokens, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.cwd,
    entry.session_id,
    entry.prompt,
    entry.result ?? null,
    entry.model ?? null,
    entry.input_tokens ?? null,
    entry.output_tokens ?? null,
    entry.duration_ms ?? null,
    entry.created_at,
  );
}

export function getHistory(cwd: string, limit = 20): HistoryEntry[] {
  return db
    .prepare(
      "SELECT * FROM history WHERE cwd = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(cwd, limit) as HistoryEntry[];
}

// --- Job accessors ---

interface JobRow {
  id: string;
  name: string;
  prompt: string;
  schedule_kind: string;
  schedule_value: string;
  delivery_kind: string;
  delivery_channel_type: string | null;
  delivery_channel_id: string | null;
  cloud: number;
  enabled: number;
  created_at: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_result: string | null;
  consecutive_errors: number;
}

function scheduleToRow(s: JobSchedule): { kind: string; value: string } {
  switch (s.kind) {
    case "at":
      return { kind: "at", value: s.at };
    case "every":
      return { kind: "every", value: String(s.everyMs) };
    case "cron":
      return { kind: "cron", value: s.expr };
  }
}

function rowToSchedule(kind: string, value: string): JobSchedule {
  switch (kind) {
    case "at":
      return { kind: "at", at: value };
    case "every":
      return { kind: "every", everyMs: Number(value) };
    case "cron":
      return { kind: "cron", expr: value };
    default:
      throw new Error(`Unknown schedule kind: ${kind}`);
  }
}

function jobRowToJob(row: JobRow): Job {
  const delivery: DeliveryTarget =
    row.delivery_kind === "channel" && row.delivery_channel_type && row.delivery_channel_id
      ? { kind: "channel", channelType: row.delivery_channel_type, channelId: row.delivery_channel_id }
      : { kind: "store" };

  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    schedule: rowToSchedule(row.schedule_kind, row.schedule_value),
    delivery,
    cloud: row.cloud === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status as Job["lastStatus"],
    lastError: row.last_error,
    lastResult: row.last_result,
    consecutiveErrors: row.consecutive_errors,
  };
}

export function addJob(job: Omit<Job, "id" | "lastRunAt" | "lastStatus" | "lastError" | "lastResult" | "consecutiveErrors">): Job {
  const id = crypto.randomUUID().slice(0, 8);
  const sched = scheduleToRow(job.schedule);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO jobs (id, name, prompt, schedule_kind, schedule_value, delivery_kind, delivery_channel_type, delivery_channel_id, cloud, enabled, created_at, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    job.name,
    job.prompt,
    sched.kind,
    sched.value,
    job.delivery.kind,
    job.delivery.kind === "channel" ? job.delivery.channelType : null,
    job.delivery.kind === "channel" ? job.delivery.channelId : null,
    job.cloud ? 1 : 0,
    job.enabled ? 1 : 0,
    now,
    job.nextRunAt,
  );

  return getJob(id)!;
}

export function getJob(id: string): Job | undefined {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? jobRowToJob(row) : undefined;
}

export function getAllJobs(): Job[] {
  const rows = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as JobRow[];
  return rows.map(jobRowToJob);
}

export function getDueJobs(now: Date): Job[] {
  const rows = db.prepare(
    "SELECT * FROM jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?",
  ).all(now.toISOString()) as JobRow[];
  return rows.map(jobRowToJob);
}

export function updateJob(id: string, updates: Partial<Pick<Job, "enabled" | "nextRunAt" | "lastRunAt" | "lastStatus" | "lastError" | "lastResult" | "consecutiveErrors">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.nextRunAt !== undefined) {
    sets.push("next_run_at = ?");
    values.push(updates.nextRunAt);
  }
  if (updates.lastRunAt !== undefined) {
    sets.push("last_run_at = ?");
    values.push(updates.lastRunAt);
  }
  if (updates.lastStatus !== undefined) {
    sets.push("last_status = ?");
    values.push(updates.lastStatus);
  }
  if (updates.lastError !== undefined) {
    sets.push("last_error = ?");
    values.push(updates.lastError);
  }
  if (updates.lastResult !== undefined) {
    sets.push("last_result = ?");
    values.push(updates.lastResult);
  }
  if (updates.consecutiveErrors !== undefined) {
    sets.push("consecutive_errors = ?");
    values.push(updates.consecutiveErrors);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeJob(id: string): boolean {
  const result = db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findJobByIdPrefix(prefix: string): Job | undefined {
  const rows = db.prepare("SELECT * FROM jobs WHERE id LIKE ?").all(`${prefix}%`) as JobRow[];
  if (rows.length === 1) return jobRowToJob(rows[0]);
  return undefined;
}
