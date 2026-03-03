import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CursorMode } from "./mode.js";
import type { Job, JobSchedule, DeliveryTarget, Pipeline, Workstation, Trigger, TriggerKind, TriggerCondition, ContextProvider, AgentRun, AgentRunKind, AgentRunStatus, Fleet, FleetStatus, Memory, BackgroundAgentRecord, Suggestion, ApprovalGate, ApprovalAction, Workflow, WorkflowStatus, WorkflowStep, Identity, NotificationLog, GitWorktree, WorktreeStatus, SpawnedProcess, SpawnedStatus, Monitor, MonitorStatus, CiStatus, ReviewRecord } from "./types.js";

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
      repository TEXT,
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

    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      condition_kind TEXT NOT NULL,
      condition_value TEXT NOT NULL,
      prompt TEXT NOT NULL,
      context_providers TEXT,
      delivery_kind TEXT NOT NULL,
      delivery_channel_type TEXT,
      delivery_channel_id TEXT,
      cloud INTEGER NOT NULL DEFAULT 0,
      repository TEXT,
      reflect INTEGER NOT NULL DEFAULT 0,
      workstation TEXT,
      mode TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_fired_at TEXT,
      last_status TEXT,
      last_error TEXT,
      fire_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_triggers_condition ON triggers(condition_kind, enabled);

    CREATE TABLE IF NOT EXISTS workstations (
      name TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      user TEXT,
      port INTEGER DEFAULT 22,
      cursor_path TEXT DEFAULT 'cursor',
      cwd TEXT NOT NULL,
      identity_file TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      parent_id TEXT,
      label TEXT NOT NULL,
      cloud_agent_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      result TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

    CREATE TABLE IF NOT EXISTS fleets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repository TEXT NOT NULL,
      tasks TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT,
      delivery_kind TEXT NOT NULL,
      delivery_channel_type TEXT,
      delivery_channel_id TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      worker_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      tags TEXT,
      source TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key);

    CREATE TABLE IF NOT EXISTS background_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      schedule TEXT NOT NULL,
      last_run_at TEXT,
      last_result TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id TEXT PRIMARY KEY,
      background_agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY (background_agent_id) REFERENCES background_agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);

    CREATE TABLE IF NOT EXISTS approval_gates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      pattern TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'ask',
      reason TEXT NOT NULL,
      delivery_kind TEXT NOT NULL,
      delivery_channel_type TEXT,
      delivery_channel_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      steps TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step INTEGER NOT NULL DEFAULT 0,
      results TEXT NOT NULL DEFAULT '{}',
      delivery_kind TEXT NOT NULL,
      delivery_channel_type TEXT,
      delivery_channel_id TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      avatar_url TEXT,
      system_prompt TEXT,
      greeting TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'sent',
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);

    CREATE TABLE IF NOT EXISTS git_worktrees (
      id TEXT PRIMARY KEY,
      branch TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      base_branch TEXT NOT NULL DEFAULT 'main',
      task_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      removed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS spawned_processes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      command TEXT NOT NULL,
      pid INTEGER,
      log_file TEXT NOT NULL,
      worktree_id TEXT,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      exit_code INTEGER,
      created_at TEXT NOT NULL,
      stopped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      branch TEXT NOT NULL,
      pr_number INTEGER,
      ci_status TEXT NOT NULL DEFAULT 'unknown',
      auto_fix INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      retry_count INTEGER NOT NULL DEFAULT 0,
      delivery_kind TEXT NOT NULL,
      delivery_channel_type TEXT,
      delivery_channel_id TEXT,
      worktree_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_check_at TEXT,
      created_at TEXT NOT NULL,
      stopped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      branch TEXT NOT NULL,
      pr_number INTEGER,
      models TEXT NOT NULL,
      delivery_kind TEXT NOT NULL,
      delivery_channel_type TEXT,
      delivery_channel_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);
}

function migrateSchema(database: Database.Database): void {
  const columns = database.pragma("table_info(jobs)") as Array<{ name: string }>;
  const names = new Set(columns.map((c) => c.name));

  if (!names.has("reflect")) {
    database.exec("ALTER TABLE jobs ADD COLUMN reflect INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.has("pipeline")) {
    database.exec("ALTER TABLE jobs ADD COLUMN pipeline TEXT");
  }
  if (!names.has("workstation")) {
    database.exec("ALTER TABLE jobs ADD COLUMN workstation TEXT");
  }
  if (!names.has("mode")) {
    database.exec("ALTER TABLE jobs ADD COLUMN mode TEXT");
  }
}

export function initDatabase(dataDir?: string): void {
  const dir = dataDir || process.env.CURECLAW_DATA_DIR || DEFAULT_DATA_DIR;
  const dbPath = path.join(dir, "store.db");
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  createSchema(db);
  migrateSchema(db);
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
  repository: string | null;
  reflect: number;
  pipeline: string | null;
  workstation: string | null;
  mode: string | null;
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

  let pipeline: Pipeline | undefined;
  if (row.pipeline) {
    try {
      pipeline = JSON.parse(row.pipeline) as Pipeline;
    } catch {
      // Ignore invalid JSON
    }
  }

  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    schedule: rowToSchedule(row.schedule_kind, row.schedule_value),
    delivery,
    cloud: row.cloud === 1,
    repository: row.repository ?? undefined,
    reflect: row.reflect === 1,
    pipeline,
    workstation: row.workstation ?? undefined,
    mode: (row.mode as CursorMode) ?? undefined,
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
    `INSERT INTO jobs (id, name, prompt, schedule_kind, schedule_value, delivery_kind, delivery_channel_type, delivery_channel_id, cloud, repository, reflect, pipeline, workstation, mode, enabled, created_at, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    job.repository ?? null,
    job.reflect ? 1 : 0,
    job.pipeline ? JSON.stringify(job.pipeline) : null,
    job.workstation ?? null,
    job.mode ?? null,
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

// --- Workstation accessors ---

interface WorkstationRow {
  name: string;
  host: string;
  user: string | null;
  port: number;
  cursor_path: string | null;
  cwd: string;
  identity_file: string | null;
  is_default: number;
  created_at: string;
}

function wsRowToWorkstation(row: WorkstationRow): Workstation {
  return {
    name: row.name,
    host: row.host,
    user: row.user ?? undefined,
    port: row.port,
    cursorPath: row.cursor_path ?? undefined,
    cwd: row.cwd,
    identityFile: row.identity_file ?? undefined,
    isDefault: row.is_default === 1,
  };
}

export function addWorkstation(ws: Workstation): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workstations (name, host, user, port, cursor_path, cwd, identity_file, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ws.name,
    ws.host,
    ws.user ?? null,
    ws.port ?? 22,
    ws.cursorPath ?? "cursor",
    ws.cwd,
    ws.identityFile ?? null,
    ws.isDefault ? 1 : 0,
    now,
  );
}

export function getWorkstation(name: string): Workstation | undefined {
  const row = db
    .prepare("SELECT * FROM workstations WHERE name = ?")
    .get(name) as WorkstationRow | undefined;
  return row ? wsRowToWorkstation(row) : undefined;
}

export function getAllWorkstations(): Workstation[] {
  const rows = db
    .prepare("SELECT * FROM workstations ORDER BY name")
    .all() as WorkstationRow[];
  return rows.map(wsRowToWorkstation);
}

export function removeWorkstation(name: string): boolean {
  const result = db.prepare("DELETE FROM workstations WHERE name = ?").run(name);
  return result.changes > 0;
}

export function getDefaultWorkstation(): Workstation | undefined {
  const row = db
    .prepare("SELECT * FROM workstations WHERE is_default = 1")
    .get() as WorkstationRow | undefined;
  return row ? wsRowToWorkstation(row) : undefined;
}

export function setDefaultWorkstation(name: string): void {
  db.prepare("UPDATE workstations SET is_default = 0").run();
  db.prepare("UPDATE workstations SET is_default = 1 WHERE name = ?").run(name);
}

// --- Trigger accessors ---

interface TriggerRow {
  id: string;
  name: string;
  condition_kind: string;
  condition_value: string;
  prompt: string;
  context_providers: string | null;
  delivery_kind: string;
  delivery_channel_type: string | null;
  delivery_channel_id: string | null;
  cloud: number;
  repository: string | null;
  reflect: number;
  workstation: string | null;
  mode: string | null;
  enabled: number;
  created_at: string;
  last_fired_at: string | null;
  last_status: string | null;
  last_error: string | null;
  fire_count: number;
}

function triggerRowToTrigger(row: TriggerRow): Trigger {
  const delivery: DeliveryTarget =
    row.delivery_kind === "channel" && row.delivery_channel_type && row.delivery_channel_id
      ? { kind: "channel", channelType: row.delivery_channel_type, channelId: row.delivery_channel_id }
      : { kind: "store" };

  let condition: TriggerCondition;
  try {
    condition = JSON.parse(row.condition_value) as TriggerCondition;
    condition.kind = row.condition_kind as TriggerCondition["kind"];
  } catch {
    condition = { kind: "webhook", name: row.name };
  }

  let contextProviders: ContextProvider[] = [];
  if (row.context_providers) {
    try {
      contextProviders = JSON.parse(row.context_providers) as ContextProvider[];
    } catch {
      // Ignore invalid JSON
    }
  }

  return {
    id: row.id,
    name: row.name,
    condition,
    prompt: row.prompt,
    contextProviders,
    delivery,
    cloud: row.cloud === 1,
    repository: row.repository ?? undefined,
    reflect: row.reflect === 1,
    workstation: row.workstation ?? undefined,
    mode: (row.mode as CursorMode) ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastFiredAt: row.last_fired_at,
    lastStatus: row.last_status as Trigger["lastStatus"],
    lastError: row.last_error,
    fireCount: row.fire_count,
  };
}

export function addTrigger(
  t: Omit<Trigger, "id" | "lastFiredAt" | "lastStatus" | "lastError" | "fireCount">,
): Trigger {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const { kind: _kind, ...conditionRest } = t.condition;

  db.prepare(
    `INSERT INTO triggers (id, name, condition_kind, condition_value, prompt, context_providers, delivery_kind, delivery_channel_type, delivery_channel_id, cloud, repository, reflect, workstation, mode, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    t.name,
    t.condition.kind,
    JSON.stringify(conditionRest),
    t.prompt,
    t.contextProviders.length > 0 ? JSON.stringify(t.contextProviders) : null,
    t.delivery.kind,
    t.delivery.kind === "channel" ? t.delivery.channelType : null,
    t.delivery.kind === "channel" ? t.delivery.channelId : null,
    t.cloud ? 1 : 0,
    t.repository ?? null,
    t.reflect ? 1 : 0,
    t.workstation ?? null,
    t.mode ?? null,
    t.enabled ? 1 : 0,
    now,
  );

  return getTrigger(id)!;
}

export function getTrigger(id: string): Trigger | undefined {
  const row = db.prepare("SELECT * FROM triggers WHERE id = ?").get(id) as TriggerRow | undefined;
  return row ? triggerRowToTrigger(row) : undefined;
}

export function getTriggerByName(name: string): Trigger | undefined {
  const row = db.prepare("SELECT * FROM triggers WHERE name = ?").get(name) as TriggerRow | undefined;
  return row ? triggerRowToTrigger(row) : undefined;
}

export function getAllTriggers(): Trigger[] {
  const rows = db.prepare("SELECT * FROM triggers ORDER BY created_at DESC").all() as TriggerRow[];
  return rows.map(triggerRowToTrigger);
}

export function getTriggersByCondition(kind: TriggerKind): Trigger[] {
  const rows = db.prepare(
    "SELECT * FROM triggers WHERE condition_kind = ? AND enabled = 1",
  ).all(kind) as TriggerRow[];
  return rows.map(triggerRowToTrigger);
}

export function updateTrigger(
  id: string,
  updates: Partial<Pick<Trigger, "enabled" | "lastFiredAt" | "lastStatus" | "lastError" | "fireCount">>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.lastFiredAt !== undefined) {
    sets.push("last_fired_at = ?");
    values.push(updates.lastFiredAt);
  }
  if (updates.lastStatus !== undefined) {
    sets.push("last_status = ?");
    values.push(updates.lastStatus);
  }
  if (updates.lastError !== undefined) {
    sets.push("last_error = ?");
    values.push(updates.lastError);
  }
  if (updates.fireCount !== undefined) {
    sets.push("fire_count = ?");
    values.push(updates.fireCount);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE triggers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeTrigger(id: string): boolean {
  const result = db.prepare("DELETE FROM triggers WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findTriggerByIdPrefix(prefix: string): Trigger | undefined {
  const rows = db.prepare("SELECT * FROM triggers WHERE id LIKE ?").all(`${prefix}%`) as TriggerRow[];
  if (rows.length === 1) return triggerRowToTrigger(rows[0]);
  return undefined;
}

// --- Agent Run accessors ---

interface AgentRunRow {
  id: string;
  kind: string;
  parent_id: string | null;
  label: string;
  cloud_agent_id: string | null;
  status: string;
  result: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

function agentRunRowToAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    kind: row.kind as AgentRunKind,
    parentId: row.parent_id,
    label: row.label,
    cloudAgentId: row.cloud_agent_id,
    status: row.status as AgentRunStatus,
    result: row.result,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function addAgentRun(
  r: Omit<AgentRun, "id" | "completedAt">,
): AgentRun {
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO agent_runs (id, kind, parent_id, label, cloud_agent_id, status, result, error, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    r.kind,
    r.parentId,
    r.label,
    r.cloudAgentId,
    r.status,
    r.result,
    r.error,
    r.startedAt,
  );
  return getAgentRun(id)!;
}

export function getAgentRun(id: string): AgentRun | undefined {
  const row = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRunRow | undefined;
  return row ? agentRunRowToAgentRun(row) : undefined;
}

export function getAgentRunsByParent(parentId: string): AgentRun[] {
  const rows = db.prepare(
    "SELECT * FROM agent_runs WHERE parent_id = ? ORDER BY started_at",
  ).all(parentId) as AgentRunRow[];
  return rows.map(agentRunRowToAgentRun);
}

export function getActiveAgentRuns(): AgentRun[] {
  const rows = db.prepare(
    "SELECT * FROM agent_runs WHERE status = 'running' ORDER BY started_at DESC",
  ).all() as AgentRunRow[];
  return rows.map(agentRunRowToAgentRun);
}

export function getRecentAgentRuns(limit = 20): AgentRun[] {
  const rows = db.prepare(
    "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?",
  ).all(limit) as AgentRunRow[];
  return rows.map(agentRunRowToAgentRun);
}

export function updateAgentRun(
  id: string,
  updates: Partial<Pick<AgentRun, "status" | "result" | "error" | "completedAt">>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.result !== undefined) {
    sets.push("result = ?");
    values.push(updates.result);
  }
  if (updates.error !== undefined) {
    sets.push("error = ?");
    values.push(updates.error);
  }
  if (updates.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(updates.completedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE agent_runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function findAgentRunByIdPrefix(prefix: string): AgentRun | undefined {
  const rows = db.prepare("SELECT * FROM agent_runs WHERE id LIKE ?").all(`${prefix}%`) as AgentRunRow[];
  if (rows.length === 1) return agentRunRowToAgentRun(rows[0]);
  return undefined;
}

// --- Fleet accessors ---

interface FleetRow {
  id: string;
  name: string;
  repository: string;
  tasks: string;
  model: string | null;
  status: string;
  summary: string | null;
  delivery_kind: string;
  delivery_channel_type: string | null;
  delivery_channel_id: string | null;
  created_at: string;
  completed_at: string | null;
  worker_count: number;
}

function fleetRowToFleet(row: FleetRow): Fleet {
  const delivery: DeliveryTarget =
    row.delivery_kind === "channel" && row.delivery_channel_type && row.delivery_channel_id
      ? { kind: "channel", channelType: row.delivery_channel_type, channelId: row.delivery_channel_id }
      : { kind: "store" };

  let tasks: string[] = [];
  try {
    tasks = JSON.parse(row.tasks) as string[];
  } catch {
    // Ignore invalid JSON
  }

  return {
    id: row.id,
    name: row.name,
    repository: row.repository,
    tasks,
    model: row.model,
    status: row.status as FleetStatus,
    summary: row.summary,
    delivery,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    workerCount: row.worker_count,
  };
}

export function addFleet(
  f: Omit<Fleet, "id" | "completedAt" | "summary">,
): Fleet {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO fleets (id, name, repository, tasks, model, status, delivery_kind, delivery_channel_type, delivery_channel_id, created_at, worker_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    f.name,
    f.repository,
    JSON.stringify(f.tasks),
    f.model,
    f.status,
    f.delivery.kind,
    f.delivery.kind === "channel" ? f.delivery.channelType : null,
    f.delivery.kind === "channel" ? f.delivery.channelId : null,
    now,
    f.workerCount,
  );

  return getFleet(id)!;
}

export function getFleet(id: string): Fleet | undefined {
  const row = db.prepare("SELECT * FROM fleets WHERE id = ?").get(id) as FleetRow | undefined;
  return row ? fleetRowToFleet(row) : undefined;
}

export function getAllFleets(): Fleet[] {
  const rows = db.prepare("SELECT * FROM fleets ORDER BY created_at DESC").all() as FleetRow[];
  return rows.map(fleetRowToFleet);
}

export function getActiveFleets(): Fleet[] {
  const rows = db.prepare(
    "SELECT * FROM fleets WHERE status = 'running' ORDER BY created_at DESC",
  ).all() as FleetRow[];
  return rows.map(fleetRowToFleet);
}

export function updateFleet(
  id: string,
  updates: Partial<Pick<Fleet, "status" | "summary" | "completedAt">>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.summary !== undefined) {
    sets.push("summary = ?");
    values.push(updates.summary);
  }
  if (updates.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(updates.completedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE fleets SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeFleet(id: string): boolean {
  const result = db.prepare("DELETE FROM fleets WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findFleetByIdPrefix(prefix: string): Fleet | undefined {
  const rows = db.prepare("SELECT * FROM fleets WHERE id LIKE ?").all(`${prefix}%`) as FleetRow[];
  if (rows.length === 1) return fleetRowToFleet(rows[0]);
  return undefined;
}

// --- Memory accessors ---

interface MemoryRow {
  id: string;
  key: string;
  content: string;
  tags: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

function memoryRowToMemory(row: MemoryRow): Memory {
  let tags: string[] = [];
  if (row.tags) {
    try {
      tags = JSON.parse(row.tags) as string[];
    } catch {
      // Ignore invalid JSON
    }
  }
  return {
    id: row.id,
    key: row.key,
    content: row.content,
    tags,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addMemory(m: Omit<Memory, "id">): Memory {
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO memory (id, key, content, tags, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    m.key,
    m.content,
    m.tags.length > 0 ? JSON.stringify(m.tags) : null,
    m.source,
    m.createdAt,
    m.updatedAt,
  );
  return getMemory(id)!;
}

export function getMemory(id: string): Memory | undefined {
  const row = db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as MemoryRow | undefined;
  return row ? memoryRowToMemory(row) : undefined;
}

export function getMemoryByKey(key: string): Memory | undefined {
  const row = db.prepare("SELECT * FROM memory WHERE key = ?").get(key) as MemoryRow | undefined;
  return row ? memoryRowToMemory(row) : undefined;
}

export function searchMemory(query: string): Memory[] {
  const pattern = `%${query}%`;
  const rows = db.prepare(
    "SELECT * FROM memory WHERE key LIKE ? OR content LIKE ? OR tags LIKE ? ORDER BY updated_at DESC",
  ).all(pattern, pattern, pattern) as MemoryRow[];
  return rows.map(memoryRowToMemory);
}

export function getAllMemories(): Memory[] {
  const rows = db.prepare("SELECT * FROM memory ORDER BY updated_at DESC").all() as MemoryRow[];
  return rows.map(memoryRowToMemory);
}

export function updateMemory(id: string, updates: Partial<Pick<Memory, "content" | "tags" | "updatedAt">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.content !== undefined) {
    sets.push("content = ?");
    values.push(updates.content);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    values.push(updates.tags.length > 0 ? JSON.stringify(updates.tags) : null);
  }
  if (updates.updatedAt !== undefined) {
    sets.push("updated_at = ?");
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE memory SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeMemory(id: string): boolean {
  const result = db.prepare("DELETE FROM memory WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Background Agent accessors ---

interface BackgroundAgentRow {
  id: string;
  name: string;
  schedule: string;
  last_run_at: string | null;
  last_result: string | null;
  enabled: number;
  created_at: string;
}

function bgAgentRowToRecord(row: BackgroundAgentRow): BackgroundAgentRecord {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

export function addBackgroundAgent(b: Omit<BackgroundAgentRecord, "id" | "lastRunAt" | "lastResult">): BackgroundAgentRecord {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO background_agents (id, name, schedule, enabled, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, b.name, b.schedule, b.enabled ? 1 : 0, now);
  return getBackgroundAgent(id)!;
}

export function getBackgroundAgent(id: string): BackgroundAgentRecord | undefined {
  const row = db.prepare("SELECT * FROM background_agents WHERE id = ?").get(id) as BackgroundAgentRow | undefined;
  return row ? bgAgentRowToRecord(row) : undefined;
}

export function getBackgroundAgentByName(name: string): BackgroundAgentRecord | undefined {
  const row = db.prepare("SELECT * FROM background_agents WHERE name = ?").get(name) as BackgroundAgentRow | undefined;
  return row ? bgAgentRowToRecord(row) : undefined;
}

export function getAllBackgroundAgents(): BackgroundAgentRecord[] {
  const rows = db.prepare("SELECT * FROM background_agents ORDER BY created_at DESC").all() as BackgroundAgentRow[];
  return rows.map(bgAgentRowToRecord);
}

export function updateBackgroundAgent(id: string, updates: Partial<Pick<BackgroundAgentRecord, "enabled" | "lastRunAt" | "lastResult">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.lastRunAt !== undefined) {
    sets.push("last_run_at = ?");
    values.push(updates.lastRunAt);
  }
  if (updates.lastResult !== undefined) {
    sets.push("last_result = ?");
    values.push(updates.lastResult);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE background_agents SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeBackgroundAgent(id: string): boolean {
  const result = db.prepare("DELETE FROM background_agents WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Suggestion accessors ---

interface SuggestionRow {
  id: string;
  background_agent_id: string;
  content: string;
  status: string;
  created_at: string;
}

function suggestionRowToSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    backgroundAgentId: row.background_agent_id,
    content: row.content,
    status: row.status as Suggestion["status"],
    createdAt: row.created_at,
  };
}

export function addSuggestion(s: Omit<Suggestion, "id">): Suggestion {
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO suggestions (id, background_agent_id, content, status, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, s.backgroundAgentId, s.content, s.status, s.createdAt);
  return { id, ...s };
}

export function getPendingSuggestions(): Suggestion[] {
  const rows = db.prepare(
    "SELECT * FROM suggestions WHERE status = 'pending' ORDER BY created_at DESC",
  ).all() as SuggestionRow[];
  return rows.map(suggestionRowToSuggestion);
}

export function updateSuggestion(id: string, status: Suggestion["status"]): void {
  db.prepare("UPDATE suggestions SET status = ? WHERE id = ?").run(status, id);
}

// --- Approval Gate accessors ---

interface ApprovalGateRow {
  id: string;
  name: string;
  pattern: string;
  action: string;
  reason: string;
  delivery_kind: string;
  delivery_channel_type: string | null;
  delivery_channel_id: string | null;
  enabled: number;
  created_at: string;
}

function gateRowToGate(row: ApprovalGateRow): ApprovalGate {
  const delivery: DeliveryTarget =
    row.delivery_kind === "channel" && row.delivery_channel_type && row.delivery_channel_id
      ? { kind: "channel", channelType: row.delivery_channel_type, channelId: row.delivery_channel_id }
      : { kind: "store" };

  return {
    id: row.id,
    name: row.name,
    pattern: row.pattern,
    action: row.action as ApprovalAction,
    reason: row.reason,
    delivery,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

export function addApprovalGate(g: Omit<ApprovalGate, "id">): ApprovalGate {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO approval_gates (id, name, pattern, action, reason, delivery_kind, delivery_channel_type, delivery_channel_id, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    g.name,
    g.pattern,
    g.action,
    g.reason,
    g.delivery.kind,
    g.delivery.kind === "channel" ? g.delivery.channelType : null,
    g.delivery.kind === "channel" ? g.delivery.channelId : null,
    g.enabled ? 1 : 0,
    now,
  );
  return getApprovalGate(id)!;
}

export function getApprovalGate(id: string): ApprovalGate | undefined {
  const row = db.prepare("SELECT * FROM approval_gates WHERE id = ?").get(id) as ApprovalGateRow | undefined;
  return row ? gateRowToGate(row) : undefined;
}

export function getAllApprovalGates(): ApprovalGate[] {
  const rows = db.prepare("SELECT * FROM approval_gates ORDER BY created_at").all() as ApprovalGateRow[];
  return rows.map(gateRowToGate);
}

export function updateApprovalGate(id: string, updates: Partial<Pick<ApprovalGate, "enabled">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE approval_gates SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeApprovalGate(id: string): boolean {
  const result = db.prepare("DELETE FROM approval_gates WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findApprovalGateByIdPrefix(prefix: string): ApprovalGate | undefined {
  const rows = db.prepare("SELECT * FROM approval_gates WHERE id LIKE ?").all(`${prefix}%`) as ApprovalGateRow[];
  if (rows.length === 1) return gateRowToGate(rows[0]);
  return undefined;
}

// --- Workflow accessors ---

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  steps: string;
  status: string;
  current_step: number;
  results: string;
  delivery_kind: string;
  delivery_channel_type: string | null;
  delivery_channel_id: string | null;
  created_at: string;
  completed_at: string | null;
}

function workflowRowToWorkflow(row: WorkflowRow): Workflow {
  const delivery: DeliveryTarget =
    row.delivery_kind === "channel" && row.delivery_channel_type && row.delivery_channel_id
      ? { kind: "channel", channelType: row.delivery_channel_type, channelId: row.delivery_channel_id }
      : { kind: "store" };

  let steps: WorkflowStep[] = [];
  try {
    steps = JSON.parse(row.steps) as WorkflowStep[];
  } catch {
    // Ignore invalid JSON
  }

  let results: Record<string, string> = {};
  try {
    results = JSON.parse(row.results) as Record<string, string>;
  } catch {
    // Ignore invalid JSON
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps,
    status: row.status as WorkflowStatus,
    currentStep: row.current_step,
    results,
    delivery,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function addWorkflow(w: Omit<Workflow, "id" | "completedAt">): Workflow {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workflows (id, name, description, steps, status, current_step, results, delivery_kind, delivery_channel_type, delivery_channel_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    w.name,
    w.description,
    JSON.stringify(w.steps),
    w.status,
    w.currentStep,
    JSON.stringify(w.results),
    w.delivery.kind,
    w.delivery.kind === "channel" ? w.delivery.channelType : null,
    w.delivery.kind === "channel" ? w.delivery.channelId : null,
    now,
  );
  return getWorkflow(id)!;
}

export function getWorkflow(id: string): Workflow | undefined {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | undefined;
  return row ? workflowRowToWorkflow(row) : undefined;
}

export function getAllWorkflows(): Workflow[] {
  const rows = db.prepare("SELECT * FROM workflows ORDER BY created_at DESC").all() as WorkflowRow[];
  return rows.map(workflowRowToWorkflow);
}

export function updateWorkflow(id: string, updates: Partial<Pick<Workflow, "status" | "currentStep" | "results" | "completedAt">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.currentStep !== undefined) {
    sets.push("current_step = ?");
    values.push(updates.currentStep);
  }
  if (updates.results !== undefined) {
    sets.push("results = ?");
    values.push(JSON.stringify(updates.results));
  }
  if (updates.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(updates.completedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE workflows SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeWorkflow(id: string): boolean {
  const result = db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findWorkflowByIdPrefix(prefix: string): Workflow | undefined {
  const rows = db.prepare("SELECT * FROM workflows WHERE id LIKE ?").all(`${prefix}%`) as WorkflowRow[];
  if (rows.length === 1) return workflowRowToWorkflow(rows[0]);
  return undefined;
}

// --- Identity accessors ---

interface IdentityRow {
  id: string;
  scope: string;
  name: string;
  avatar_url: string | null;
  system_prompt: string | null;
  greeting: string | null;
  created_at: string;
  updated_at: string;
}

function identityRowToIdentity(row: IdentityRow): Identity {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    avatarUrl: row.avatar_url,
    systemPrompt: row.system_prompt,
    greeting: row.greeting,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addIdentity(i: Omit<Identity, "id">): Identity {
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO identities (id, scope, name, avatar_url, system_prompt, greeting, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, i.scope, i.name, i.avatarUrl, i.systemPrompt, i.greeting, i.createdAt, i.updatedAt);
  return getIdentity(id)!;
}

export function getIdentity(id: string): Identity | undefined {
  const row = db.prepare("SELECT * FROM identities WHERE id = ?").get(id) as IdentityRow | undefined;
  return row ? identityRowToIdentity(row) : undefined;
}

export function getIdentityByScope(scope: string): Identity | undefined {
  const row = db.prepare("SELECT * FROM identities WHERE scope = ?").get(scope) as IdentityRow | undefined;
  return row ? identityRowToIdentity(row) : undefined;
}

export function getAllIdentities(): Identity[] {
  const rows = db.prepare("SELECT * FROM identities ORDER BY scope").all() as IdentityRow[];
  return rows.map(identityRowToIdentity);
}

export function updateIdentity(
  id: string,
  updates: Partial<Pick<Identity, "name" | "avatarUrl" | "systemPrompt" | "greeting" | "updatedAt">>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.avatarUrl !== undefined) {
    sets.push("avatar_url = ?");
    values.push(updates.avatarUrl);
  }
  if (updates.systemPrompt !== undefined) {
    sets.push("system_prompt = ?");
    values.push(updates.systemPrompt);
  }
  if (updates.greeting !== undefined) {
    sets.push("greeting = ?");
    values.push(updates.greeting);
  }
  if (updates.updatedAt !== undefined) {
    sets.push("updated_at = ?");
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE identities SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeIdentity(id: string): boolean {
  const result = db.prepare("DELETE FROM identities WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Notification Log accessors ---

interface NotificationLogRow {
  id: string;
  channel_type: string;
  channel_id: string;
  message: string;
  source: string;
  status: string;
  error: string | null;
  created_at: string;
}

function notifRowToNotificationLog(row: NotificationLogRow): NotificationLog {
  return {
    id: row.id,
    channelType: row.channel_type,
    channelId: row.channel_id,
    message: row.message,
    source: row.source,
    status: row.status as NotificationLog["status"],
    error: row.error,
    createdAt: row.created_at,
  };
}

export function addNotificationLog(n: Omit<NotificationLog, "id">): NotificationLog {
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO notification_log (id, channel_type, channel_id, message, source, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, n.channelType, n.channelId, n.message, n.source, n.status, n.error, n.createdAt);
  return { id, ...n };
}

export function getRecentNotifications(limit = 20): NotificationLog[] {
  const rows = db.prepare(
    "SELECT * FROM notification_log ORDER BY created_at DESC LIMIT ?",
  ).all(limit) as NotificationLogRow[];
  return rows.map(notifRowToNotificationLog);
}

// --- Git Worktree accessors ---

interface WorktreeRow {
  id: string;
  branch: string;
  path: string;
  base_branch: string;
  task_id: string | null;
  status: string;
  created_at: string;
  removed_at: string | null;
}

function worktreeRowToWorktree(row: WorktreeRow): GitWorktree {
  return {
    id: row.id,
    branch: row.branch,
    path: row.path,
    baseBranch: row.base_branch,
    taskId: row.task_id,
    status: row.status as WorktreeStatus,
    createdAt: row.created_at,
    removedAt: row.removed_at,
  };
}

export function addWorktree(w: Omit<GitWorktree, "id" | "removedAt">): GitWorktree {
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO git_worktrees (id, branch, path, base_branch, task_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, w.branch, w.path, w.baseBranch, w.taskId, w.status, w.createdAt);
  return getWorktreeById(id)!;
}

export function getWorktreeById(id: string): GitWorktree | undefined {
  const row = db.prepare("SELECT * FROM git_worktrees WHERE id = ?").get(id) as WorktreeRow | undefined;
  return row ? worktreeRowToWorktree(row) : undefined;
}

export function getWorktreeByBranch(branch: string): GitWorktree | undefined {
  const row = db.prepare("SELECT * FROM git_worktrees WHERE branch = ?").get(branch) as WorktreeRow | undefined;
  return row ? worktreeRowToWorktree(row) : undefined;
}

export function getActiveWorktrees(): GitWorktree[] {
  const rows = db.prepare(
    "SELECT * FROM git_worktrees WHERE status = 'active' ORDER BY created_at DESC",
  ).all() as WorktreeRow[];
  return rows.map(worktreeRowToWorktree);
}

export function getAllWorktrees(): GitWorktree[] {
  const rows = db.prepare("SELECT * FROM git_worktrees ORDER BY created_at DESC").all() as WorktreeRow[];
  return rows.map(worktreeRowToWorktree);
}

export function updateWorktreeRecord(id: string, updates: Partial<Pick<GitWorktree, "status" | "removedAt" | "taskId">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.removedAt !== undefined) {
    sets.push("removed_at = ?");
    values.push(updates.removedAt);
  }
  if (updates.taskId !== undefined) {
    sets.push("task_id = ?");
    values.push(updates.taskId);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE git_worktrees SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeWorktreeRecord(id: string): boolean {
  const result = db.prepare("DELETE FROM git_worktrees WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Spawned Process accessors ---

interface SpawnedProcessRow {
  id: string;
  name: string;
  command: string;
  pid: number | null;
  log_file: string;
  worktree_id: string | null;
  cwd: string;
  status: string;
  exit_code: number | null;
  created_at: string;
  stopped_at: string | null;
}

function spawnedRowToProcess(row: SpawnedProcessRow): SpawnedProcess {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    pid: row.pid,
    logFile: row.log_file,
    worktreeId: row.worktree_id,
    cwd: row.cwd,
    status: row.status as SpawnedStatus,
    exitCode: row.exit_code,
    createdAt: row.created_at,
    stoppedAt: row.stopped_at,
  };
}

export function addSpawnedProcess(p: Omit<SpawnedProcess, "id" | "stoppedAt" | "exitCode">): SpawnedProcess {
  const id = crypto.randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO spawned_processes (id, name, command, pid, log_file, worktree_id, cwd, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, p.name, p.command, p.pid, p.logFile, p.worktreeId, p.cwd, p.status, p.createdAt);
  return getSpawnedProcess(id)!;
}

export function getSpawnedProcess(id: string): SpawnedProcess | undefined {
  const row = db.prepare("SELECT * FROM spawned_processes WHERE id = ?").get(id) as SpawnedProcessRow | undefined;
  return row ? spawnedRowToProcess(row) : undefined;
}

export function getSpawnedByName(name: string): SpawnedProcess | undefined {
  const row = db.prepare("SELECT * FROM spawned_processes WHERE name = ?").get(name) as SpawnedProcessRow | undefined;
  return row ? spawnedRowToProcess(row) : undefined;
}

export function getRunningSpawned(): SpawnedProcess[] {
  const rows = db.prepare(
    "SELECT * FROM spawned_processes WHERE status = 'running' ORDER BY created_at DESC",
  ).all() as SpawnedProcessRow[];
  return rows.map(spawnedRowToProcess);
}

export function getAllSpawned(): SpawnedProcess[] {
  const rows = db.prepare("SELECT * FROM spawned_processes ORDER BY created_at DESC").all() as SpawnedProcessRow[];
  return rows.map(spawnedRowToProcess);
}

export function updateSpawnedProcess(id: string, updates: Partial<Pick<SpawnedProcess, "status" | "exitCode" | "stoppedAt" | "pid">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.exitCode !== undefined) {
    sets.push("exit_code = ?");
    values.push(updates.exitCode);
  }
  if (updates.stoppedAt !== undefined) {
    sets.push("stopped_at = ?");
    values.push(updates.stoppedAt);
  }
  if (updates.pid !== undefined) {
    sets.push("pid = ?");
    values.push(updates.pid);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE spawned_processes SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeSpawnedProcess(id: string): boolean {
  const result = db.prepare("DELETE FROM spawned_processes WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Monitor accessors ---

interface MonitorRow {
  id: string;
  branch: string;
  pr_number: number | null;
  ci_status: string;
  auto_fix: number;
  max_retries: number;
  retry_count: number;
  delivery_kind: string;
  delivery_channel_type: string | null;
  delivery_channel_id: string | null;
  worktree_id: string | null;
  status: string;
  last_check_at: string | null;
  created_at: string;
  stopped_at: string | null;
}

function monitorRowToMonitor(row: MonitorRow): Monitor {
  const delivery: DeliveryTarget =
    row.delivery_kind === "channel" && row.delivery_channel_type && row.delivery_channel_id
      ? { kind: "channel", channelType: row.delivery_channel_type, channelId: row.delivery_channel_id }
      : { kind: "store" };

  return {
    id: row.id,
    branch: row.branch,
    prNumber: row.pr_number,
    ciStatus: row.ci_status as CiStatus,
    autoFix: row.auto_fix === 1,
    maxRetries: row.max_retries,
    retryCount: row.retry_count,
    delivery,
    worktreeId: row.worktree_id,
    status: row.status as MonitorStatus,
    lastCheckAt: row.last_check_at,
    createdAt: row.created_at,
    stoppedAt: row.stopped_at,
  };
}

export function addMonitor(m: Omit<Monitor, "id" | "stoppedAt" | "lastCheckAt" | "retryCount" | "ciStatus">): Monitor {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO monitors (id, branch, pr_number, ci_status, auto_fix, max_retries, retry_count, delivery_kind, delivery_channel_type, delivery_channel_id, worktree_id, status, created_at)
     VALUES (?, ?, ?, 'unknown', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    m.branch,
    m.prNumber,
    m.autoFix ? 1 : 0,
    m.maxRetries,
    m.delivery.kind,
    m.delivery.kind === "channel" ? m.delivery.channelType : null,
    m.delivery.kind === "channel" ? m.delivery.channelId : null,
    m.worktreeId,
    m.status,
    now,
  );
  return getMonitor(id)!;
}

export function getMonitor(id: string): Monitor | undefined {
  const row = db.prepare("SELECT * FROM monitors WHERE id = ?").get(id) as MonitorRow | undefined;
  return row ? monitorRowToMonitor(row) : undefined;
}

export function getActiveMonitors(): Monitor[] {
  const rows = db.prepare(
    "SELECT * FROM monitors WHERE status = 'active' ORDER BY created_at DESC",
  ).all() as MonitorRow[];
  return rows.map(monitorRowToMonitor);
}

export function getMonitorByBranch(branch: string): Monitor | undefined {
  const row = db.prepare(
    "SELECT * FROM monitors WHERE branch = ? AND status = 'active'",
  ).get(branch) as MonitorRow | undefined;
  return row ? monitorRowToMonitor(row) : undefined;
}

export function updateMonitor(id: string, updates: Partial<Pick<Monitor, "status" | "ciStatus" | "prNumber" | "retryCount" | "lastCheckAt" | "stoppedAt">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.ciStatus !== undefined) {
    sets.push("ci_status = ?");
    values.push(updates.ciStatus);
  }
  if (updates.prNumber !== undefined) {
    sets.push("pr_number = ?");
    values.push(updates.prNumber);
  }
  if (updates.retryCount !== undefined) {
    sets.push("retry_count = ?");
    values.push(updates.retryCount);
  }
  if (updates.lastCheckAt !== undefined) {
    sets.push("last_check_at = ?");
    values.push(updates.lastCheckAt);
  }
  if (updates.stoppedAt !== undefined) {
    sets.push("stopped_at = ?");
    values.push(updates.stoppedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE monitors SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeMonitor(id: string): boolean {
  const result = db.prepare("DELETE FROM monitors WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findMonitorByIdPrefix(prefix: string): Monitor | undefined {
  const rows = db.prepare("SELECT * FROM monitors WHERE id LIKE ?").all(`${prefix}%`) as MonitorRow[];
  if (rows.length === 1) return monitorRowToMonitor(rows[0]);
  return undefined;
}

// --- Review accessors ---

interface ReviewRow {
  id: string;
  branch: string;
  pr_number: number | null;
  models: string;
  delivery_kind: string;
  delivery_channel_type: string | null;
  delivery_channel_id: string | null;
  status: string;
  summary: string | null;
  created_at: string;
  completed_at: string | null;
}

function reviewRowToReview(row: ReviewRow): ReviewRecord {
  const delivery: DeliveryTarget =
    row.delivery_kind === "channel" && row.delivery_channel_type && row.delivery_channel_id
      ? { kind: "channel", channelType: row.delivery_channel_type, channelId: row.delivery_channel_id }
      : { kind: "store" };

  let models: string[] = [];
  try {
    models = JSON.parse(row.models) as string[];
  } catch {
    // Ignore invalid JSON
  }

  return {
    id: row.id,
    branch: row.branch,
    prNumber: row.pr_number,
    models,
    delivery,
    status: row.status as ReviewRecord["status"],
    summary: row.summary,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function addReview(r: Omit<ReviewRecord, "id" | "completedAt" | "summary" | "createdAt">): ReviewRecord {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO reviews (id, branch, pr_number, models, delivery_kind, delivery_channel_type, delivery_channel_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    r.branch,
    r.prNumber,
    JSON.stringify(r.models),
    r.delivery.kind,
    r.delivery.kind === "channel" ? r.delivery.channelType : null,
    r.delivery.kind === "channel" ? r.delivery.channelId : null,
    r.status,
    now,
  );
  return getReview(id)!;
}

export function getReview(id: string): ReviewRecord | undefined {
  const row = db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as ReviewRow | undefined;
  return row ? reviewRowToReview(row) : undefined;
}

export function getAllReviews(): ReviewRecord[] {
  const rows = db.prepare("SELECT * FROM reviews ORDER BY created_at DESC").all() as ReviewRow[];
  return rows.map(reviewRowToReview);
}

export function updateReview(id: string, updates: Partial<Pick<ReviewRecord, "status" | "summary" | "completedAt">>): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.summary !== undefined) {
    sets.push("summary = ?");
    values.push(updates.summary);
  }
  if (updates.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(updates.completedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE reviews SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function removeReview(id: string): boolean {
  const result = db.prepare("DELETE FROM reviews WHERE id = ?").run(id);
  return result.changes > 0;
}
