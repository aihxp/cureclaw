# CureClaw

Personal AI assistant that wraps Cursor CLI as a subprocess with a Pi-Mono-style event-driven agent loop. SQLite persistence for session continuity. Telegram and WhatsApp channels for remote access. Job scheduler with cron/interval/one-shot support. Cloud Agent API, skills scaffolding, MCP server configuration, plugin packaging. Steering queues, reflection loop, and prompt pipelines for multi-step workflows.

## Quick Context

Single TypeScript process. Spawns `cursor agent --print --output-format stream-json --trust` as a child process, parses NDJSON stdout line-by-line, translates Cursor events into AgentEvents, and streams them to subscribers. Sessions auto-resume via `--resume <chatId>` so multi-turn conversations persist across prompts. Telegram and WhatsApp channels provide remote access with one Agent per chat. Supports `--cloud` for Cursor cloud agents (subprocess or Cloud API). Built-in scheduler runs jobs on cron/interval/one-shot schedules and delivers results to channels. Skills, MCP servers, and plugin packaging support the Cursor ecosystem. Steering queues buffer follow-up prompts while agent streams, reflection runs a verification pass after execution, and prompt pipelines chain multiple steps in a single session.

## Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | All type definitions: Cursor stream types + AgentEvent types + config |
| `src/event-stream.ts` | Generic async iterable EventStream (adapted from pi-mono) |
| `src/cursor-client.ts` | Spawns cursor subprocess, provides async line iterator, passes `--resume` |
| `src/agent-loop.ts` | Translates CursorStreamEvent → AgentEvent, manages turn/message state |
| `src/agent.ts` | High-level Agent class: subscribe/prompt/abort with DB persistence, steering, reflection, pipeline |
| `src/steering.ts` | SteeringQueue — FIFO buffer for follow-up prompts while agent streams |
| `src/reflection.ts` | Reflection prompt template + pass/fail detection |
| `src/pipeline.ts` | Pipeline types, prompt parsing, template interpolation ({{prev}}, {{step.N}}) |
| `src/db.ts` | SQLite schema, init, session/config/history/job accessors (better-sqlite3) |
| `src/channels/channel.ts` | Minimal Channel interface (start/stop) |
| `src/channels/telegram.ts` | Telegram bot: grammY, one Agent per chat, typing indicators, HTML formatting |
| `src/channels/whatsapp.ts` | WhatsApp bot: Baileys, QR auth, one Agent per JID, reconnect + outgoing queue |
| `src/cli.ts` | Interactive readline CLI with ANSI rendering and slash commands |
| `src/index.ts` | Entry point, CLI/Telegram/WhatsApp/one-shot mode dispatch, DB init |
| `src/scheduler/parse-schedule.ts` | Parse schedule strings (at/every/cron) into JobSchedule |
| `src/scheduler/compute-next-run.ts` | Compute next run time for all schedule kinds |
| `src/scheduler/delivery.ts` | Delivery handler registry (channels register on start) |
| `src/scheduler/commands.ts` | Shared /schedule, /jobs, /cancel command handlers |
| `src/scheduler/scheduler.ts` | Timer loop: check due jobs, execute (local or Cloud API), deliver, re-arm |
| `src/cloud/types.ts` | Cloud Agent API request/response types |
| `src/cloud/client.ts` | CloudClient class (native fetch, Basic auth) |
| `src/cloud/commands.ts` | /cloud launch\|status\|stop\|list\|conversation\|models command handlers |
| `src/skills/scaffold.ts` | Generate skill directory + SKILL.md template |
| `src/skills/list.ts` | Discover skills from standard paths (.agents/skills, .cursor/skills, ~/.cursor/skills) |
| `src/skills/commands.ts` | /skill create, /skills command handlers |
| `src/mcp/config.ts` | Read/write .cursor/mcp.json (MCP server configuration) |
| `src/mcp/commands.ts` | /mcp list\|add\|remove command handlers |
| `src/plugin/manifest.ts` | Generate plugin.json manifest from workspace artifacts |
| `src/plugin/build.ts` | Assemble distributable plugin from workspace |
| `src/plugin/commands.ts` | /plugin build\|info command handlers |

## Architecture

```
CLI          →  Agent(cwd)   →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
Telegram Bot →  Agent(chat1) →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
             →  Agent(chat2) →  ...
WhatsApp     →  Agent(jid1)  →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
             →  Agent(jid2)  →  ...
Scheduler    →  Agent(job:N) →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
             →  CloudClient  →  Cloud API    →  api.cursor.com (for cloud+repo jobs)
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
- Bot commands: `/start`, `/new`, `/status`, `/schedule`, `/jobs`, `/cancel`, `/cloud`, `/skill`, `/skills`, `/mcp`
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
- With `CURSOR_API_KEY` set, scheduler can use the Cloud Agent API directly for jobs with `--repo`

### Cloud API

- Requires `CURSOR_API_KEY` env var
- Native fetch client with Basic auth against `api.cursor.com`
- Commands: `/cloud launch`, `/cloud status`, `/cloud stop`, `/cloud list`, `/cloud conversation`, `/cloud models`
- Scheduler jobs with `cloud: true` + `repository` use CloudClient instead of local subprocess (falls back on error)

### Skills

- Scaffolding: `/skill create <name>` creates `.agents/skills/<name>/SKILL.md` + scripts/ + references/
- Discovery: `/skills` scans workspace/.agents/skills/, workspace/.cursor/skills/, ~/.cursor/skills/
- SKILL.md frontmatter: `---\nname: ...\ndescription: "..."\n---`

### MCP Servers

- Configuration stored in `.cursor/mcp.json`
- Commands: `/mcp list`, `/mcp add <name> <command> [args]`, `/mcp remove <name>`
- `--approve-mcps` passed alongside `--yolo` when autoApprove is set

### Plugins

- `/plugin build` assembles workspace artifacts into a distributable plugin
- `/plugin info` shows what would be included (dry run)
- Copies rules, skills, agents, and sanitized MCP config into output dir
- Generates `plugin.json` manifest in `.cursor-plugin/`

### Steering Queues

- Type while agent is streaming to queue follow-up prompts
- Queued prompts auto-feed after the current prompt completes
- All follow-ups share the same Cursor session via `--resume`
- Channels (Telegram/WhatsApp) queue messages instead of rejecting while busy
- `agent.queueFollowUp(text)`, `agent.queuedCount`, `agent.clearQueue()`

### Reflection Loop

- Optional verification pass after execution
- Enable per-prompt: `agent.prompt(text, { reflect: true })`
- Enable globally: `new Agent(config, { reflect: true })`
- Enable per-job: `/schedule "prompt" every 1h --reflect`
- Default prompt asks agent to review for errors and say "LGTM" if clean
- Pass detection: case-insensitive match against "lgtm", "looks good to me", etc.

### Prompt Pipelines

- Chain multiple prompts as sequential steps in a single session
- `/pipeline "step 1" [--reflect] "step 2" [--reflect] "step 3"`
- `--reflect` after a quoted prompt adds a reflection pass for that step
- Template interpolation: `{{prev}}` for previous step output, `{{step.N}}` for step N
- Pipeline jobs: scheduled jobs can have a `pipeline` field

### Scheduler

- Runs automatically in CLI, Telegram, and WhatsApp modes
- Timer loop checks for due jobs every 60s (or immediately when jobs are due)
- Schedule formats: `at <ISO8601>` (one-shot), `every <N><s|m|h|d>` (interval), `cron <5-field>` (cron)
- Error backoff: 30s → 1m → 5m → 15m → 60m (consecutive errors)
- One-shot (`at`) jobs auto-disable after execution
- Delivery: channels register handlers on start; results delivered to originating channel
- Commands: `/schedule "prompt" <schedule> [--cloud] [--repo <url>]`, `/jobs`, `/cancel <id-prefix>`
- Jobs with `--cloud --repo <url>` use Cloud API when `CURSOR_API_KEY` is available

## Event Flow

Cursor emits NDJSON on stdout → parsed in cursor-client → translated in agent-loop → pushed to EventStream → consumed by Agent → emitted to subscribers.

Event types: `agent_start`, `thinking_delta`, `thinking_end`, `turn_start`, `message_start`, `message_delta`, `message_end`, `tool_start`, `tool_end`, `turn_end`, `agent_end`, `error`, `followup_start`, `followup_end`, `reflection_start`, `reflection_end`, `pipeline_start`, `step_start`, `step_end`, `pipeline_end`.

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

## Roadmap Vision

**v0.7 — Steering & Reflection (current):** Steering queues (auto-feed follow-up prompts on turn completion), reflection loop (post-execution verification pass), prompt pipelines (chained multi-step execution).

**v0.8 — Event-Driven Autonomy:** Webhook triggers (HTTP endpoint for external signals), file watchers, conditional job chains (job A → job B), inactivity triggers, continuous context injection (git diff, test results, issues auto-injected).

**v0.9 — Multi-Agent Orchestration:** Planner agent (goal → subtask tree), parallel worker agents, inter-agent messaging (shared DB queue), aggregator, goal decomposition.

**v1.0 — General-Purpose Personal Assistant:** Beyond coding — weather, calendar, appointments, email, reminders via MCP. Proactive suggestions, long-term memory (user habits/preferences), approval gates for high-stakes actions, cross-domain tool chaining (deploy + notify on Slack).
