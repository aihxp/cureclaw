# CureClaw

Personal AI assistant that wraps Cursor CLI as a subprocess with a Pi-Mono-style event-driven agent loop. SQLite persistence for session continuity. Telegram and WhatsApp channels for remote access. Job scheduler with cron/interval/one-shot support and cloud mode.

## Quick Context

Single TypeScript process. Spawns `cursor agent --print --output-format stream-json --trust` as a child process, parses NDJSON stdout line-by-line, translates Cursor events into AgentEvents, and streams them to subscribers. Sessions auto-resume via `--resume <chatId>` so multi-turn conversations persist across prompts. Telegram and WhatsApp channels provide remote access with one Agent per chat. Supports `--cloud` for Cursor cloud agents. Built-in scheduler runs jobs on cron/interval/one-shot schedules and delivers results to channels.

## Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | All type definitions: Cursor stream types + AgentEvent types + config |
| `src/event-stream.ts` | Generic async iterable EventStream (adapted from pi-mono) |
| `src/cursor-client.ts` | Spawns cursor subprocess, provides async line iterator, passes `--resume` |
| `src/agent-loop.ts` | Translates CursorStreamEvent → AgentEvent, manages turn/message state |
| `src/agent.ts` | High-level Agent class: subscribe/prompt/abort with DB persistence + sessionKey |
| `src/db.ts` | SQLite schema, init, session/config/history accessors (better-sqlite3) |
| `src/channels/channel.ts` | Minimal Channel interface (start/stop) |
| `src/channels/telegram.ts` | Telegram bot: grammY, one Agent per chat, typing indicators, HTML formatting |
| `src/channels/whatsapp.ts` | WhatsApp bot: Baileys, QR auth, one Agent per JID, reconnect + outgoing queue |
| `src/cli.ts` | Interactive readline CLI with ANSI rendering and slash commands |
| `src/index.ts` | Entry point, CLI/Telegram/WhatsApp/one-shot mode dispatch, DB init |
| `src/scheduler/parse-schedule.ts` | Parse schedule strings (at/every/cron) into JobSchedule |
| `src/scheduler/compute-next-run.ts` | Compute next run time for all schedule kinds |
| `src/scheduler/delivery.ts` | Delivery handler registry (channels register on start) |
| `src/scheduler/commands.ts` | Shared /schedule, /jobs, /cancel command handlers |
| `src/scheduler/scheduler.ts` | Timer loop: check due jobs, execute, deliver, re-arm |

## Architecture

```
CLI          →  Agent(cwd)   →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
Telegram Bot →  Agent(chat1) →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
             →  Agent(chat2) →  ...
WhatsApp     →  Agent(jid1)  →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
             →  Agent(jid2)  →  ...
Scheduler    →  Agent(job:N) →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
                                                                     ↓
                                                              deliver(target)
```

Sessions keyed by `resolvedCwd` (CLI), `tg:<chatId>` (Telegram), or `wa:<jid>` (WhatsApp) in shared SQLite DB.

## Persistence

- **DB location:** `~/.cureclaw/store.db` (override via `CURECLAW_DATA_DIR`)
- **Session key:** resolved cwd for CLI, `tg:<chatId>` for Telegram, `wa:<jid>` for WhatsApp
- **Runtime deps:** `better-sqlite3`, `grammy`, `@whiskeysockets/baileys`, `pino`, `qrcode-terminal`
- Tables: `sessions` (key → chatId), `history` (prompt/result/tokens), `config` (key/value), `jobs` (scheduler)

## Channels

### Telegram (`--telegram`)

- Requires `TELEGRAM_BOT_TOKEN` env var
- Optional `TELEGRAM_ALLOWED_USERS` (comma-separated user IDs)
- Workspace dir: `CURECLAW_WORKSPACE` or `~/.cureclaw/workspace/`
- Bot commands: `/start`, `/new`, `/status`, `/schedule`, `/jobs`, `/cancel`
- One Agent per chat, concurrent chats run independently

### WhatsApp (`--whatsapp`)

- Uses Baileys (WhatsApp Web protocol) — first run prints QR to scan
- Auth persisted at `~/.cureclaw/whatsapp-auth/` — subsequent runs auto-connect
- Optional `WHATSAPP_ALLOWED_JIDS` (comma-separated JIDs)
- Optional `WHATSAPP_TRIGGER` — trigger word required in groups (DMs always respond)
- Optional `WHATSAPP_BOT_NAME` — name prefix for outgoing messages
- Workspace dir: `CURECLAW_WORKSPACE` or `~/.cureclaw/workspace/`
- One Agent per JID, sessions keyed by `wa:<jid>`
- Outgoing queue buffers messages during disconnect, flushes on reconnect

### Cloud Mode (`--cloud`)

- Pass `--cloud` flag to run Cursor agent in cloud mode (isolated VMs)
- Can be set globally via CLI flag or per-job via `/schedule ... --cloud`
- Cloud mode enables computer use, subagents, and plugins

### Scheduler

- Runs automatically in CLI, Telegram, and WhatsApp modes
- Timer loop checks for due jobs every 60s (or immediately when jobs are due)
- Schedule formats: `at <ISO8601>` (one-shot), `every <N><s|m|h|d>` (interval), `cron <5-field>` (cron)
- Error backoff: 30s → 1m → 5m → 15m → 60m (consecutive errors)
- One-shot (`at`) jobs auto-disable after execution
- Delivery: channels register handlers on start; results delivered to originating channel
- Commands: `/schedule "prompt" <schedule> [--cloud]`, `/jobs`, `/cancel <id-prefix>`

## Event Flow

Cursor emits NDJSON on stdout → parsed in cursor-client → translated in agent-loop → pushed to EventStream → consumed by Agent → emitted to subscribers.

Event types: `agent_start`, `thinking_delta`, `thinking_end`, `turn_start`, `message_start`, `message_delta`, `message_end`, `tool_start`, `tool_end`, `turn_end`, `agent_end`, `error`.

## Development

```bash
npm run dev                              # CLI mode with tsx
npm run build                            # Compile TypeScript
npm test                                 # Run tests
npm run dev -- --cloud -p "hello"        # Cloud mode one-shot
TELEGRAM_BOT_TOKEN=xxx npm run dev -- --telegram  # Telegram mode
npm run dev -- --whatsapp                         # WhatsApp mode (QR auth)
```

## Conventions

- TypeScript strict mode, ES modules with `.js` imports
- Minimal runtime dependencies — better-sqlite3 + grammy + baileys + pino + qrcode-terminal
- No over-engineering: each file has one job
- Tool name extraction: find key ending in `ToolCall`, strip suffix
- Partial vs final assistant messages: `timestamp_ms` present = delta, absent = final
