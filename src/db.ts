import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
