# CureClaw

Cursor ecosystem orchestration platform. Wraps Cursor CLI as a subprocess with a Pi-Mono-style event-driven agent loop. SQLite persistence for session continuity. Telegram and WhatsApp channels for remote access. Job scheduler with cron/interval/one-shot support. Cloud Agent API with autonomous steering via follow-ups. Skills scaffolding, MCP server configuration, hooks management, subagent discovery, custom commands, plugin packaging. Steering queues, reflection loop, and prompt pipelines for multi-step workflows. Multi-workstation support via SSH for remote execution. Agent modes (agent/plan/ask), image attachments, webhook receiver.

## Quick Context

Single TypeScript process. Spawns `cursor agent --print --output-format stream-json --trust` as a child process, parses NDJSON stdout line-by-line, translates Cursor events into AgentEvents, and streams them to subscribers. Sessions auto-resume via `--resume <chatId>` so multi-turn conversations persist across prompts. Telegram and WhatsApp channels provide remote access with one Agent per chat. Supports `--cloud` for Cursor cloud agents (subprocess or Cloud API). Built-in scheduler runs jobs on cron/interval/one-shot schedules and delivers results to channels. Agent modes (`--mode plan|ask`) control Cursor CLI behavior. Cloud steering autonomously follows up cloud agents via the API. Webhook server receives cloud agent status changes. Hooks, subagents, and custom commands integrate with the Cursor ecosystem. Skills, MCP servers, and plugin packaging support the Cursor ecosystem. Steering queues buffer follow-up prompts while agent streams, reflection runs a verification pass after execution, and prompt pipelines chain multiple steps in a single session. Workstations enable remote execution via SSH — `spawn("ssh", ...)` instead of `spawn("cursor", ...)`, with NDJSON streaming unchanged.

## Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | All type definitions: Cursor stream types + AgentEvent types + config |
| `src/event-stream.ts` | Generic async iterable EventStream (adapted from pi-mono) |
| `src/cursor-client.ts` | Spawns cursor subprocess (local or SSH), provides async line iterator, passes `--resume` |
| `src/workstation.ts` | Name validation, resolveWorkstation() for SSH target resolution |
| `src/workstation-commands.ts` | /workstation add\|remove\|list\|default\|status command handlers |
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
| `src/mode.ts` | CursorMode type, validation, ?/! prefix parsing |
| `src/images.ts` | Image attachment types + Cloud API conversion |
| `src/webhook/server.ts` | Lightweight HTTP webhook receiver (node:http, HMAC-SHA256) |
| `src/cloud/types.ts` | Cloud Agent API request/response types |
| `src/cloud/client.ts` | CloudClient class (native fetch, Basic auth) |
| `src/cloud/commands.ts` | /cloud launch\|steer\|status\|stop\|list\|conversation\|models command handlers |
| `src/cloud/steering.ts` | Autonomous cloud agent loop (follow-up API, evaluators) |
| `src/hooks/config.ts` | Read/write .cursor/hooks.json |
| `src/hooks/commands.ts` | /hooks list\|add\|remove command handlers |
| `src/agents/list.ts` | .cursor/agents/ discovery (subagent .md files) |
| `src/agents/scaffold.ts` | Subagent scaffolding |
| `src/agents/commands.ts` | /agents, /agent create command handlers |
| `src/commands/list.ts` | .cursor/commands/ discovery |
| `src/commands/commands.ts` | /commands, /run command handlers |
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

Workstation: spawnCursor() → spawn("ssh", [..., "cd /path && cursor agent ..."]) → remote NDJSON
                                                                     ↓
                                                              deliver(target)
```

Sessions keyed by `resolvedCwd` (CLI), `tg:<chatId>` (Telegram), or `wa:<jid>` (WhatsApp) in shared SQLite DB. Workstation sessions prefixed with `ws:<name>:` for isolation (e.g., `ws:dev:/home/user/project`).

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
- Bot commands: `/start`, `/new`, `/status`, `/mode`, `/schedule`, `/jobs`, `/cancel`, `/cloud`, `/hooks`, `/agents`, `/commands`, `/run`, `/skill`, `/skills`, `/mcp`
- Photo messages: downloads largest size, passes as image attachment to agent (cloud mode)
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

### Workstations (`--workstation`)

- Register remote dev servers, VMs, or workstations for SSH-based remote execution
- `spawn("ssh", ...)` instead of `spawn("cursor", ...)` — NDJSON streaming unchanged
- `--workstation <name>` flag targets a registered workstation for all prompts
- `@name` prefix in prompts targets a specific workstation for that prompt only
- Session keys prefixed with `ws:<name>:` for per-workstation session isolation
- SSH options: `BatchMode=yes`, `StrictHostKeyChecking=accept-new`, `ConnectTimeout=10`
- DB table: `workstations` (name, host, user, port, cursor_path, cwd, identity_file, is_default)
- Commands: `/workstation list|add|remove|default|status`
- Scheduler: `/schedule "prompt" every 1h --workstation dev`
- Magic name `local` overrides default workstation (forces local execution)

### Cloud Mode (`--cloud`)

- Pass `--cloud` flag to run Cursor agent in cloud mode (isolated VMs)
- Can be set globally via CLI flag or per-job via `/schedule ... --cloud`
- Cloud mode enables computer use, subagents, and plugins
- With `CURSOR_API_KEY` set, scheduler can use the Cloud Agent API directly for jobs with `--repo`

### Cloud API

- Requires `CURSOR_API_KEY` env var
- Native fetch client with Basic auth against `api.cursor.com`
- Commands: `/cloud launch`, `/cloud steer`, `/cloud status`, `/cloud stop`, `/cloud list`, `/cloud conversation`, `/cloud models`
- `/cloud steer` launches a cloud agent and autonomously steers it via follow-ups until LGTM or max attempts
- Scheduler jobs with `cloud: true` + `repository` use CloudClient instead of local subprocess (falls back on error)

### Agent Modes (`--mode`)

- `--mode plan`: Cursor read-only analysis mode
- `--mode ask`: Cursor Q&A mode (read-only)
- No flag / `agent`: Full agent mode (default)
- `/mode <agent|plan|ask>` switches mode interactively
- Prefix prompts: `?question` → ask mode, `!instruction` → plan mode
- Per-job: `/schedule "prompt" every 4h --mode plan`

### Webhook Server

- Lightweight HTTP server using `node:http` (zero deps)
- HMAC-SHA256 signature verification on POST /webhook
- Receives cloud agent status change events
- Environment: `CURECLAW_WEBHOOK_PORT`, `CURECLAW_WEBHOOK_URL`, `CURECLAW_WEBHOOK_SECRET`

### Image Attachments

- Telegram: photo messages downloaded and passed as base64 to agent
- Cloud API: images included in `CloudPrompt.images` array
- Max 5 images per prompt

### Skills

- Scaffolding: `/skill create <name>` creates `.agents/skills/<name>/SKILL.md` + scripts/ + references/
- Discovery: `/skills` scans workspace/.agents/skills/, workspace/.cursor/skills/, ~/.cursor/skills/
- SKILL.md frontmatter: `---\nname: ...\ndescription: "..."\n---`

### MCP Servers

- Configuration stored in `.cursor/mcp.json`
- Commands: `/mcp list`, `/mcp add <name> <command> [args]`, `/mcp remove <name>`
- `--approve-mcps` passed alongside `--yolo` when autoApprove is set

### Hooks

- Configuration stored in `.cursor/hooks.json`
- Commands: `/hooks list`, `/hooks add <event> <command> [args]`, `/hooks remove <event> <command>`
- Supported events: sessionStart, stop, beforeSubmitPrompt, preToolUse, postToolUse, postToolUseFailure, subagentStart, subagentStop, beforeShellExecution, afterShellExecution, beforeMCPExecution, afterMCPExecution, beforeReadFile, afterFileEdit, preCompact, afterCompact, beforeReset

### Subagents

- Discovery: `/agents` scans `.cursor/agents/` (workspace) and `~/.cursor/agents/` (global)
- Subagents are `.md` files with YAML frontmatter (name, description, model, readonly, is_background)
- Scaffolding: `/agent create <name> [--model <m>] [--readonly] [--description "..."]`
- Creates `.cursor/agents/<name>.md` with frontmatter + instructions template

### Custom Commands

- Discovery: `/commands` scans `.cursor/commands/` (workspace) and `~/.cursor/commands/` (global)
- Commands are `.md` files with optional frontmatter (description) and a prompt template body
- `/run <name> [context]` feeds the command template (+ optional context) as a prompt to the agent

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
- Commands: `/schedule "prompt" <schedule> [--cloud] [--repo <url>] [--mode <m>]`, `/jobs`, `/cancel <id-prefix>`
- Jobs with `--cloud --repo <url>` use Cloud API when `CURSOR_API_KEY` is available

## Event Flow

Cursor emits NDJSON on stdout → parsed in cursor-client → translated in agent-loop → pushed to EventStream → consumed by Agent → emitted to subscribers.

Event types: `agent_start`, `thinking_delta`, `thinking_end`, `turn_start`, `message_start`, `message_delta`, `message_end`, `tool_start`, `tool_end`, `turn_end`, `agent_end`, `error`, `followup_start`, `followup_end`, `reflection_start`, `reflection_end`, `pipeline_start`, `step_start`, `step_end`, `pipeline_end`, `cloud_steer_start`, `cloud_steer_followup`, `cloud_steer_end`.

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

**v0.9 — Cursor Ecosystem Deep Integration (current):** Agent modes (agent/plan/ask), webhook triggers, cloud steering (autonomous follow-ups), hooks management (.cursor/hooks.json), subagent discovery (.cursor/agents/), custom commands (.cursor/commands/), image attachments, scheduler mode flag.

**v0.10 — Event-Driven Autonomy:** Hook-driven triggers (Cursor hooks as event sources → agent jobs), cloud webhook chains, conditional job graphs, context-aware prompts (.cursor/rules/ + git diff injection), cron + hook hybrids.

**v0.11 — Multi-Agent Orchestration:** Subagent coordination via .cursor/agents/, cloud agent fleet (parallel Cloud API agents), background agents (is_background flag), goal decomposition via planner subagent, inter-agent context via .cursor/commands/ templates + MCP state.

**v1.0 — General-Purpose Personal Assistant:** MCP tool ecosystem (weather, calendar, email via community MCP servers), proactive background subagents, long-term memory via MCP + SQLite, hook-based approval gates, cross-domain MCP tool chaining (deploy → Slack → Jira).
