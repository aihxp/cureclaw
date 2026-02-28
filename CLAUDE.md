# CureClaw

Personal AI assistant that wraps Cursor CLI as a subprocess with a Pi-Mono-style event-driven agent loop. SQLite persistence for session continuity. Telegram channel for remote access.

## Quick Context

Single TypeScript process. Spawns `cursor agent --print --output-format stream-json --trust` as a child process, parses NDJSON stdout line-by-line, translates Cursor events into AgentEvents, and streams them to subscribers. Sessions auto-resume via `--resume <chatId>` so multi-turn conversations persist across prompts. Telegram bot provides remote access with one Agent per chat.

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
| `src/cli.ts` | Interactive readline CLI with ANSI rendering and slash commands |
| `src/index.ts` | Entry point, CLI/Telegram/one-shot mode dispatch, DB init |

## Architecture

```
CLI          →  Agent(cwd)   →  agentLoop()  →  spawnCursor()  →  cursor agent
Telegram Bot →  Agent(chat1) →  agentLoop()  →  spawnCursor()  →  cursor agent
             →  Agent(chat2) →  ...
```

Sessions keyed by `resolvedCwd` (CLI) or `tg:<chatId>` (Telegram) in shared SQLite DB.

## Persistence

- **DB location:** `~/.cureclaw/store.db` (override via `CURECLAW_DATA_DIR`)
- **Session key:** resolved cwd for CLI, `tg:<chatId>` for Telegram
- **Runtime deps:** `better-sqlite3`, `grammy`
- Tables: `sessions` (key → chatId), `history` (prompt/result/tokens), `config` (key/value)

## Channels

### Telegram (`--telegram`)

- Requires `TELEGRAM_BOT_TOKEN` env var
- Optional `TELEGRAM_ALLOWED_USERS` (comma-separated user IDs)
- Workspace dir: `CURECLAW_WORKSPACE` or `~/.cureclaw/workspace/`
- Bot commands: `/start`, `/new`, `/status`
- One Agent per chat, concurrent chats run independently

## Event Flow

Cursor emits NDJSON on stdout → parsed in cursor-client → translated in agent-loop → pushed to EventStream → consumed by Agent → emitted to subscribers.

Event types: `agent_start`, `thinking_delta`, `thinking_end`, `turn_start`, `message_start`, `message_delta`, `message_end`, `tool_start`, `tool_end`, `turn_end`, `agent_end`, `error`.

## Development

```bash
npm run dev                    # CLI mode with tsx
npm run build                  # Compile TypeScript
TELEGRAM_BOT_TOKEN=xxx npm run dev -- --telegram  # Telegram mode
```

## Conventions

- TypeScript strict mode, ES modules with `.js` imports
- Minimal runtime dependencies — better-sqlite3 + grammy
- No over-engineering: each file has one job
- Tool name extraction: find key ending in `ToolCall`, strip suffix
- Partial vs final assistant messages: `timestamp_ms` present = delta, absent = final
