# CureClaw

General-purpose personal assistant powered by Cursor CLI. Wraps Cursor CLI as a subprocess with a Pi-Mono-style event-driven agent loop. SQLite persistence for session continuity. Five channels for remote access: Telegram, WhatsApp, Slack, and Discord bots plus a CureClaw MCP server (Cursor becomes the dashboard). Agent identity/persona with configurable name, avatar, system prompt, and greeting per channel. Proactive notifications pushed to any channel with delivery logging. Job scheduler with cron/interval/one-shot support. Cloud Agent API with autonomous steering via follow-ups. Enhanced subagent coordination (run, steer, kill, list active). Skills scaffolding, MCP server configuration, hooks management, subagent discovery, custom commands, plugin packaging. Steering queues, reflection loop, and prompt pipelines for multi-step workflows. Multi-workstation support via SSH for remote execution. Agent modes (agent/plan/ask), image attachments, webhook receiver. Fleet execution (parallel cloud agents), goal decomposition (planner → workers), and agent run registry. Long-term memory (SQLite-backed /remember, /recall, /forget). Proactive background agents with suggestion system. Approval gates for tool execution control. Curated MCP server presets with /mcp install. Cross-domain workflow engine with conditions and step chaining. Git worktree isolation for parallel agent work. External process spawning and steering. CI/PR monitoring with auto-fix. Multi-persona code review. Adaptive retry with context-adapted prompts.

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
| `src/trigger/context.ts` | Context provider execution + prompt template interpolation |
| `src/trigger/engine.ts` | Trigger matching, firing, event processing (cycle detection) |
| `src/trigger/commands.ts` | /trigger add\|remove\|list\|enable\|disable\|info command handlers |
| `src/fleet/registry.ts` | Agent run tracking (startRun, completeRun, formatting) |
| `src/fleet/fleet.ts` | Fleet execution engine (parallel cloud agents, monitor, stop) |
| `src/fleet/decompose.ts` | Goal decomposition (planner prompt, subtask parsing) |
| `src/fleet/commands.ts` | /fleet, /orchestrate, /runs, /run info command handlers |
| `src/memory/memory.ts` | Long-term memory CRUD + search + context builder |
| `src/memory/commands.ts` | /remember, /recall, /forget command handlers |
| `src/background/runner.ts` | BackgroundRunner class (periodic scan + agent dispatch) |
| `src/background/commands.ts` | /background register\|unregister\|list\|suggest\|status handlers |
| `src/approval/gates.ts` | Gate matching, approval check logic |
| `src/approval/commands.ts` | /approval add\|list\|remove\|enable\|disable handlers |
| `src/mcp/presets.ts` | Curated MCP server registry (static data + install) |
| `src/workflow/engine.ts` | Workflow step execution engine |
| `src/workflow/commands.ts` | /workflow create\|run\|status\|list\|stop\|remove handlers |
| `src/channels/slack.ts` | Slack bot: @slack/bolt, socket mode + HTTP, one Agent per channel |
| `src/channels/discord.ts` | Discord bot: discord.js, gateway + intents, one Agent per channel |
| `src/identity/identity.ts` | Identity CRUD + resolution chain + system prompt/greeting |
| `src/identity/commands.ts` | /identity set\|show\|list\|remove command handlers |
| `src/notifications/notify.ts` | Notification dispatch + logging via delivery handlers |
| `src/notifications/commands.ts` | /notify send\|log command handlers |
| `src/mcp-server/index.ts` | MCP server entry point (stdin/stdout JSON-RPC) |
| `src/mcp-server/protocol.ts` | MCP JSON-RPC types |
| `src/mcp-server/tools.ts` | 12 MCP tool definitions + handlers |
| `src/worktree/worktree.ts` | Git worktree CRUD (create, remove, cleanup) |
| `src/worktree/commands.ts` | /worktree create\|list\|remove\|cleanup handlers |
| `src/spawn/manager.ts` | Process lifecycle (spawn, kill, steer stdin, log) |
| `src/spawn/commands.ts` | /spawn start\|list\|steer\|kill\|log handlers |
| `src/monitor/checker.ts` | GitHub interaction via `gh` CLI (pr status, ci checks) |
| `src/monitor/monitor.ts` | CiMonitor class (2-min background loop, auto-fix) |
| `src/monitor/commands.ts` | /monitor pr\|list\|stop handlers |
| `src/review/personas.ts` | 3 reviewer personas (security, architecture, performance) |
| `src/review/review.ts` | Review engine (parallel agents in ask mode, aggregation) |
| `src/review/commands.ts` | /review branch handlers |
| `src/adaptive/evaluators.ts` | Evaluator functions (ci, test, shell, review) |
| `src/adaptive/retry.ts` | Adaptive retry loop (context-adapted prompt rewriting) |
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
Slack Bot    →  Agent(ch1)   →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
             →  Agent(ch2)   →  ...
Discord Bot  →  Agent(ch1)   →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
             →  Agent(ch2)   →  ...
MCP Server   →  stdin/stdout JSON-RPC  →  SQLite DB (read-only tools)
Scheduler    →  Agent(job:N) →  agentLoop()  →  spawnCursor()  →  cursor agent [--cloud]
             →  CloudClient  →  Cloud API    →  api.cursor.com (for cloud+repo jobs)
Fleet        →  CloudClient  →  Cloud API ×N →  parallel cloud agents (per-task)
Orchestrate  →  Agent(plan)  →  decompose    →  Fleet or sequential Agent workers

Workstation: spawnCursor() → spawn("ssh", [..., "cd /path && cursor agent ..."]) → remote NDJSON
                                                                     ↓
                                                              deliver(target)
```

Sessions keyed by `resolvedCwd` (CLI), `tg:<chatId>` (Telegram), `wa:<jid>` (WhatsApp), `slack:<channelId>` (Slack), or `discord:<channelId>` (Discord) in shared SQLite DB. Workstation sessions prefixed with `ws:<name>:` for isolation (e.g., `ws:dev:/home/user/project`).

## Persistence

- **DB location:** `~/.cureclaw/store.db` (override via `CURECLAW_DATA_DIR`)
- **Session key:** resolved cwd for CLI, `tg:<chatId>` for Telegram, `wa:<jid>` for WhatsApp
- **Runtime deps:** `better-sqlite3`, `grammy`, `@whiskeysockets/baileys`, `pino`, `qrcode-terminal`, `@slack/bolt`, `discord.js`
- Tables: `sessions` (key → chatId), `history` (prompt/result/tokens), `config` (key/value), `jobs` (scheduler), `triggers`, `workstations`, `agent_runs`, `fleets`, `memory`, `background_agents`, `suggestions`, `approval_gates`, `workflows`, `identities`, `notification_log`, `git_worktrees`, `spawned_processes`, `monitors`, `reviews`

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

### Slack (`--slack`)

- Uses `@slack/bolt` (socket mode or HTTP)
- Requires `SLACK_BOT_TOKEN` env var
- Optional `SLACK_APP_TOKEN` for socket mode (no public URL needed)
- Optional `SLACK_SIGNING_SECRET` for HTTP mode
- Optional `SLACK_ALLOWED_CHANNELS` (comma-separated channel IDs)
- One Agent per channel with session key `slack:<channelId>`
- Threading: all responses go in thread under original message
- Message limit: split at 3000 chars (Slack limit ~4000)
- Full command dispatch (same cascade as other channels + identity/notify)
- Delivery handler registered for scheduler/trigger integration

### Discord (`--discord`)

- Uses `discord.js` with gateway intents
- Requires `DISCORD_BOT_TOKEN` env var
- Optional `DISCORD_ALLOWED_CHANNELS` (comma-separated channel IDs)
- Optional `DISCORD_ALLOWED_GUILDS` (comma-separated guild IDs)
- One Agent per channel/DM with session key `discord:<channelId>`
- Threading: long responses (>2000 chars) auto-create a thread
- Message limit: split at 2000 chars (Discord hard limit)
- Typing indicator: refresh every 8s (Discord typing lasts ~10s)
- Bot messages ignored via `message.author.bot` check

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

### Triggers

- Event-driven job execution: webhook POSTs, job completions, cloud agent status changes
- Three trigger kinds: `webhook`, `job_complete`, `cloud_complete`
- Context providers gather runtime data before prompt execution: `git_diff`, `git_log`, `shell`, `file`
- Prompt templates support `{{context.NAME}}` for context and `{{event.status}}`, `{{event.result}}`, `{{event.payload}}` for event data
- Trigger webhook endpoint: `POST /trigger/:name` (optional `CURECLAW_TRIGGER_SECRET` auth)
- Cloud status changes automatically fire `cloud_complete` triggers via webhook server
- Job completions automatically fire `job_complete` triggers via scheduler integration
- Cycle detection: max depth 5 prevents infinite trigger chains
- Commands: `/trigger add`, `/trigger list`, `/trigger remove`, `/trigger enable`, `/trigger disable`, `/trigger info`
- DB table: `triggers` with condition, context providers, delivery, fire count tracking

### Fleet

- Launches multiple cloud agents in parallel on the same repository with different tasks
- Each agent runs independently; results are aggregated into a summary
- Commands: `/fleet launch <repo> "task1" "task2" ...`, `/fleet status <id>`, `/fleet stop <id>`, `/fleet list`
- Uses `CloudClient.launchAgents()` for parallel launch via `Promise.allSettled`
- Fleet monitoring polls all agents concurrently, updates agent runs as they complete
- DB tables: `fleets` (fleet records) + `agent_runs` (per-worker tracking)
- Fleet status: "completed" if any agent succeeded, "error" if all failed

### Orchestration

- Takes a high-level goal, runs a planner agent to decompose into subtasks, dispatches workers
- `/orchestrate "goal" [--cloud] [--repo <url>] [--model m] [--workers N]`
- Planner prompt instructs agent to output JSON array of `{name, task}` subtasks
- With `--cloud --repo`: launches a cloud fleet with the subtasks
- Without `--cloud`: executes subtasks sequentially via local Agent
- `parseSubtasks()` handles JSON extraction from markdown fences and surrounding text

### Agent Run Registry

- Tracks every agent execution: fleet workers, orchestration steps, trigger-fired agents, scheduled jobs
- Six run kinds: `fleet`, `orchestrate`, `trigger`, `job`, `prompt`, `subagent`
- Commands: `/runs [--active]`, `/run info <id-prefix>`
- DB table: `agent_runs` with kind, parent_id, cloud_agent_id, status, result, error

### Long-Term Memory

- SQLite-backed persistent memory with key-value storage, tags, and full-text search
- Commands: `/remember <key> <content> [--tags tag1,tag2]`, `/recall [query]`, `/forget <key>`, `/memory help`
- `remember()` upserts by key — creates new or updates existing memory
- `recall(query)` searches across key, content, and tags via SQL LIKE
- `buildMemoryContext(query)` generates a context block from top 5 matching memories for injection into prompts
- Memory context provider: triggers can use `--context memory:query` to inject relevant memories via `{{context.memories}}`
- DB table: `memory` (id, key, content, tags JSON, source, created_at, updated_at)

### Background Agents

- Proactive subagent runner that periodically scans and dispatches registered background agents
- BackgroundRunner class with 5-minute interval timer, schedule parsing, and suggestion extraction
- Commands: `/background register <name> <schedule>`, `/background unregister <name>`, `/background list`, `/background suggest`, `/background accept <id>`, `/background dismiss <id>`, `/background status`, `/background help`
- Schedule format: `every <N><s|m|h|d>` (e.g., `every 30m`, `every 1h`)
- Background agents discover subagent `.md` files, run in ask mode, parse actionable suggestions from output
- Suggestions accumulate in DB until user reviews via `/background suggest`
- DB tables: `background_agents` (id, name, schedule, last_run_at, last_result, enabled), `suggestions` (id, background_agent_id, content, status)

### Approval Gates

- Pattern-based approval/deny rules before tool execution
- Regex pattern matching against `toolName + " " + description`
- Three actions: `allow` (permit), `deny` (block), `ask` (prompt for approval)
- First matching gate wins; no match defaults to allow (permissive)
- Commands: `/approval add <name> <pattern> <allow|deny|ask> "reason"`, `/approval list`, `/approval remove <id-prefix>`, `/approval enable <id-prefix>`, `/approval disable <id-prefix>`, `/approval help`
- DB table: `approval_gates` (id, name, pattern, action, reason, delivery, enabled)

### MCP Tool Presets

- Curated registry of 10 community MCP servers with one-command install
- Presets: filesystem, github, slack, postgres, sqlite, brave-search, fetch, memory, puppeteer, google-maps
- Commands: `/mcp install <name>`, `/mcp presets [category]`
- Categories: dev-tools, communication, productivity
- `checkPresetEnv()` validates required environment variables before installation
- Static data — no network calls for preset listing

### Cross-Domain Workflows

- Multi-step workflow engine with conditions, template interpolation, and step chaining
- Four step kinds: `prompt` (Agent), `cloud` (CloudClient), `shell` (execSync), `condition` (expression evaluation)
- Interpolation: `{{step.NAME}}` replaced with result from step NAME, `{{step.NAME.status}}` for success/error
- Condition steps evaluate expressions and jump to `onTrue`/`onFalse` step names
- Commands: `/workflow create <name> <json-steps>`, `/workflow run <id-prefix>`, `/workflow status <id-prefix>`, `/workflow list`, `/workflow stop <id-prefix>`, `/workflow remove <id-prefix>`, `/workflow help`
- Sequential execution with DB persistence of current step and accumulated results
- DB table: `workflows` (id, name, description, steps JSON, status, current_step, results JSON, delivery)

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

### CureClaw MCP Server (`--mcp-server`)

- Standalone JSON-RPC 2.0 server over stdin/stdout (zero new deps)
- Exposes CureClaw system state as 8 MCP tools: `cureclaw_status`, `cureclaw_sessions`, `cureclaw_jobs`, `cureclaw_memory`, `cureclaw_agents`, `cureclaw_workflows`, `cureclaw_runs`, `cureclaw_triggers`
- Self-registration: `/mcp install cureclaw` adds to `.cursor/mcp.json`
- Reads from same `~/.cureclaw/store.db` database
- Cursor can query CureClaw state directly via tool calls (acts as a dashboard)

### Agent Identity/Persona

- Configurable name, avatar URL, system prompt, and greeting per channel
- Resolution chain: channel-specific → global → null (fallback)
- System prompt injected into every agent prompt as `[System: ...]` prefix
- Greeting shown on /start or first message
- Commands: `/identity set <field> <value> [--scope <scope>]`, `/identity show`, `/identity list`, `/identity remove <scope>`
- Scopes: `global`, `telegram`, `whatsapp`, `slack`, `discord`
- DB table: `identities` (id, scope, name, avatar_url, system_prompt, greeting)

### Proactive Notifications

- Push messages to any channel without user prompting
- Uses existing delivery handler system for cross-channel delivery
- Every notification logged to `notification_log` table (sent/failed)
- Commands: `/notify <channelType>:<channelId> "message"`, `/notify log [limit]`
- Background runner automatically notifies on new suggestions
- Sources: manual, workflow, scheduler, background, trigger

### Enhanced Subagent Coordination

- Run, steer, list, and kill subagents interactively
- `/agent run <name> [prompt]` — discovers subagent .md file, creates Agent, runs in background
- `/agent run` supports `--worktree <branch>` (set cwd to worktree), `--adaptive` (retry on failure), `--max-retries N`, `--evaluator ci|test|shell`, `--eval-cmd "cmd"`
- `/agent steer <prefix> "follow-up"` — sends follow-up to running subagent
- `/agent kill <prefix>` — aborts running subagent
- `/agent list --active` — shows running subagents with status
- Tracked in agent_runs with kind `"subagent"` via fleet registry
- Live subagents tracked in module-level Map for prefix-based lookup

### Git Worktree Isolation

- Create isolated git worktrees for parallel agent work on separate branches
- Commands: `/worktree create <branch> [--base <ref>]`, `/worktree list`, `/worktree remove <branch>`, `/worktree cleanup`
- Worktree path: `../<repoName>-<branch>` (sibling directory of current repo)
- Auto-detects package manager (pnpm/yarn/npm) and runs install
- DB table: `git_worktrees` (id, branch, path, base_branch, task_id, status, created_at, removed_at)
- Cleanup prunes stale worktrees (path no longer exists on disk)

### External Process Spawning

- Spawn and manage external processes (Codex, Claude Code, any CLI)
- Commands: `/spawn <name> <command> [--worktree <branch>]`, `/spawn list`, `/spawn steer <name> "msg"`, `/spawn kill <name>`, `/spawn log <name> [lines]`
- stdout + stderr piped to `~/.cureclaw/logs/<name>.log`
- Steer via stdin, read logs, kill with SIGTERM
- DB table: `spawned_processes` (id, name, command, pid, log_file, worktree_id, cwd, status, exit_code)
- Process reconciliation on startup: marks orphaned "running" records as "exited"

### CI/PR Monitoring

- Background loop monitors CI/PR status via `gh` CLI (2-minute interval)
- Commands: `/monitor pr <branch> [--auto-fix] [--max-retries N]`, `/monitor list`, `/monitor stop <id-prefix>`
- On CI failure + auto-fix: spawns agent with failure context, increments retry count
- On status change: delivers notification to configured channel
- Auto-completes when CI transitions from failing to passing
- DB table: `monitors` (id, branch, pr_number, ci_status, auto_fix, max_retries, retry_count, delivery, status)

### Multi-Persona Code Review

- Run parallel code reviews with different reviewer personas
- Commands: `/review <branch> [--models security,architecture,performance] [--post]`
- 3 built-in personas: security (input validation, edge cases), architecture (design patterns), performance (complexity, allocations)
- Each persona runs as an Agent in ask mode with system prompt injection
- `--post` posts aggregated review as GitHub PR comment
- DB table: `reviews` (id, branch, pr_number, models, delivery, status, summary)

### Adaptive Retry

- Retry agent execution with context-adapted prompts on failure
- Enabled via `--adaptive` flag on `/agent run`
- Evaluators: `ci` (check CI via gh), `test` (run npm test), `shell` (arbitrary command), `review`
- On failure: evaluator gathers error context, builds adapted prompt with failure details
- Loop continues until evaluator passes or max retries reached
- Run kind: `adaptive` in agent_runs

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

**v0.9 — Cursor Ecosystem Deep Integration:** Agent modes (agent/plan/ask), webhook triggers, cloud steering (autonomous follow-ups), hooks management (.cursor/hooks.json), subagent discovery (.cursor/agents/), custom commands (.cursor/commands/), image attachments, scheduler mode flag.

**v0.10 — Event-Driven Autonomy:** Trigger system (webhook, job_complete, cloud_complete), context providers (git_diff, git_log, shell, file), prompt template interpolation ({{context.*}}, {{event.*}}), trigger commands (/trigger add|list|remove|enable|disable|info), webhook endpoint (POST /trigger/:name), scheduler→trigger chaining, cycle detection (max depth 5).

**v0.11 — Multi-Agent Orchestration:** Fleet execution (parallel cloud agents), goal decomposition (planner → workers), agent run registry (visibility into all agent activity), /fleet launch|status|stop|list, /orchestrate "goal", /runs, /run info. CloudClient.launchAgents() parallel helper.

**v1.0 — General-Purpose Personal Assistant:** Long-term memory (SQLite-backed /remember, /recall, /forget + memory context provider). Proactive background agents (periodic subagent execution + suggestion system). Approval gates (pattern-based allow/deny/ask rules for tool execution). Curated MCP presets (/mcp install for 10 community servers). Cross-domain workflows (multi-step engine with prompt/cloud/shell/condition steps, interpolation, conditions).

**v1.1 — Full-Blown AI Assistant:** Slack channel (@slack/bolt, socket mode + HTTP). Discord channel (discord.js, gateway + intents). CureClaw MCP server (8 tools, stdin/stdout JSON-RPC, self-registration). Agent identity/persona (configurable name, avatar, system prompt, greeting per channel). Proactive notifications (push to any channel, notification log). Enhanced subagent coordination (/agent run, steer, kill, list --active).

**v1.2 — Agent Swarm (current):** Git worktree isolation (agents work in parallel on isolated branches). External process spawning and steering (Codex, Claude Code, any CLI). CI/PR monitoring with auto-fix (2-min background loop via `gh` CLI). Multi-persona code review (security, architecture, performance — parallel agents in ask mode). Adaptive retry with context-adapted prompts (evaluators: ci, test, shell). 12 MCP tools. Tables: git_worktrees, spawned_processes, monitors, reviews.
