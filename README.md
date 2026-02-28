# CureClaw

Personal AI assistant powered by Cursor CLI with an event-driven agent loop.

CureClaw wraps Cursor's agent CLI as a subprocess and translates its output into a structured event stream, giving you full programmatic control over the agent lifecycle. The event system is inspired by [Pi-Mono](https://github.com/badlogic/pi-mono)'s `agentLoop()` pattern.

## Quick Start

```bash
# Prerequisites: Node.js >= 20, Cursor CLI installed

# Install
git clone <repo-url>
cd cureclaw
npm install

# Interactive mode
npm run dev

# One-shot mode
npx tsx src/index.ts -p "Explain what this project does"

# With a specific model
npx tsx src/index.ts --model sonnet-4

# Auto-approve all tool calls
npx tsx src/index.ts --yolo
```

## How It Works

```
You type a prompt
      |
      v
  Agent.prompt()
      |
      v
  agentLoop() spawns:
  cursor agent --print --output-format stream-json --trust "your prompt"
      |
      v
  Cursor's NDJSON stdout is parsed line-by-line
      |
      v
  Each Cursor event is translated to an AgentEvent
      |
      v
  Events stream to subscribers (CLI renderer, your code, etc.)
      |
      v
  You see thinking, text, tool calls, and usage stats in real time
```

CureClaw does not call LLM APIs directly. Cursor CLI handles model selection, tool execution, context management, and multi-turn reasoning internally. CureClaw provides the structured event layer on top.

## CLI Usage

```
CureClaw v0.8 — Cursor CLI agent with workstations, Cloud API, skills, MCP, and plugins

Usage:
  cureclaw [options]              Interactive mode
  cureclaw -p "prompt"            One-shot mode
  cureclaw --telegram             Telegram bot mode
  cureclaw --whatsapp             WhatsApp mode (Baileys)

Options:
  --model <model>           Model to use (e.g., sonnet-4, gpt-5)
  --yolo, --force           Auto-approve all tool calls
  --cloud                   Run Cursor agent in cloud mode
  --workstation <name>      Target a registered workstation for remote execution
  --cwd <dir>               Working directory for cursor agent
  --cursor-path <path>      Path to cursor CLI binary
  --no-stream               Disable partial output streaming
  --new                     Start a fresh session (clear saved session for cwd)
  --telegram                Start as a Telegram bot (requires TELEGRAM_BOT_TOKEN)
  --whatsapp                Start as a WhatsApp bot (uses Baileys, QR auth)
  -p, --prompt <text>       Run a single prompt and exit
  -h, --help                Show this help
```

### Interactive Commands

| Command | Action |
|---------|--------|
| `/new` | Clear session, start fresh |
| `/sessions` | List all saved sessions |
| `/history` | Show recent prompts for current directory |
| `/schedule "prompt" <schedule>` | Schedule a recurring job (`--reflect` for verification) |
| `/jobs` | List all scheduled jobs |
| `/cancel <id-prefix>` | Remove a scheduled job |
| `/pipeline "step1" "step2"` | Run multi-step pipeline (`--reflect` per step) |
| `/workstation list\|add\|remove\|default\|status` | Manage remote workstations |
| `@name <prompt>` | Run prompt on a specific workstation |
| `/cloud <subcommand>` | Cloud agent commands (launch, status, stop, list, conversation, models) |
| `/skill create <name>` | Scaffold a new skill |
| `/skills` | List discovered skills |
| `/mcp list\|add\|remove` | Manage MCP server configuration |
| `/plugin build\|info` | Build or inspect plugin package |
| `/help` | Show available commands |
| `/quit` | Exit CureClaw |
| `Ctrl+C` | Abort current prompt (if streaming) or exit (if idle) |

### Session Continuity

CureClaw automatically persists Cursor sessions per working directory. When you send a second prompt from the same directory, Cursor resumes with full conversation context via `--resume <chatId>`.

```bash
# First prompt starts a new session
cureclaw -p "explain the auth module"

# Second prompt resumes — Cursor remembers the conversation
cureclaw -p "now refactor it to use JWT"

# Force a fresh session
cureclaw --new -p "start over with a clean slate"
```

Session data is stored in `~/.cureclaw/store.db` (SQLite).

### Telegram Bot

Run CureClaw as a Telegram bot for remote access from any device:

```bash
# Start the bot (get a token from @BotFather)
TELEGRAM_BOT_TOKEN=your_token cureclaw --telegram

# Restrict access to specific users
TELEGRAM_BOT_TOKEN=your_token TELEGRAM_ALLOWED_USERS=12345,67890 cureclaw --telegram
```

Each Telegram chat gets its own Agent with independent session continuity. Bot commands:
- `/start` — Welcome message
- `/new` — Clear session, start fresh
- `/status` — Show current session info

### WhatsApp Bot

Run CureClaw as a WhatsApp bot using Baileys (WhatsApp Web protocol):

```bash
# First run — prints QR code to scan with WhatsApp
cureclaw --whatsapp

# Restrict to specific JIDs
WHATSAPP_ALLOWED_JIDS=123456789@s.whatsapp.net cureclaw --whatsapp

# Group trigger word — only respond in groups when trigger is present
WHATSAPP_TRIGGER=@CureClaw cureclaw --whatsapp

# Custom bot name prefix on outgoing messages
WHATSAPP_BOT_NAME=CureClaw cureclaw --whatsapp
```

- First run prints a QR code — scan it with WhatsApp to authenticate
- Auth is persisted at `~/.cureclaw/whatsapp-auth/` so subsequent runs auto-connect
- Each JID gets its own Agent with independent session continuity (keyed by `wa:<jid>`)
- DMs always get a response; group messages require the trigger word (if set)
- Outgoing message queue buffers during disconnects and flushes on reconnect

### Workstations

Run prompts on remote dev servers, VMs, or workstations via SSH:

```bash
# Register a workstation
/workstation add dev user@192.168.1.100 /home/user/project

# Set it as the default
/workstation default dev

# Run a prompt on a specific workstation
@dev explain this project

# Test SSH connectivity
/workstation status dev

# Schedule a job on a workstation
/schedule "check health" every 1h --workstation dev

# List all workstations
/workstation list

# Remove a workstation
/workstation remove dev

# Override default with local execution
@local explain this project
```

Workstations use SSH with `BatchMode=yes` (no interactive auth — requires key-based SSH). The remote machine must have Cursor CLI installed. NDJSON output streams back over SSH unchanged, so all existing features (session resume, reflection, pipelines) work transparently on remote workstations.

### Cloud Mode

Run Cursor agent in cloud mode (isolated VMs with computer use, subagents, and plugins):

```bash
# One-shot with cloud
cureclaw --cloud -p "deploy the staging environment"

# Interactive with cloud
cureclaw --cloud

# Cloud jobs via scheduler
/schedule "run nightly tests" every 24h --cloud
```

### Cloud API

Use the Cursor Cloud Agent REST API for launching and managing cloud agents programmatically:

```bash
# Set your API key
export CURSOR_API_KEY=your_key

# Launch a cloud agent on a repo
/cloud launch "fix the failing tests" https://github.com/user/repo --pr

# Check agent status
/cloud status <agent-id>

# Get the conversation transcript
/cloud conversation <agent-id>

# List recent agents
/cloud list

# List available models
/cloud models

# Stop a running agent
/cloud stop <agent-id>
```

Scheduler jobs with `--cloud --repo <url>` use the Cloud API directly when `CURSOR_API_KEY` is set.

### Skills

Scaffold and discover Cursor skills:

```bash
# Create a new skill
/skill create deploy --description "Deploy to production"

# List all discovered skills
/skills
```

Skills are discovered from:
1. `workspace/.agents/skills/` (workspace)
2. `workspace/.cursor/skills/` (project)
3. `~/.cursor/skills/` (global)

### MCP Servers

Configure Model Context Protocol servers for use by Cursor:

```bash
# List configured servers
/mcp list

# Add a server
/mcp add github npx -y @modelcontextprotocol/server-github

# Remove a server
/mcp remove github
```

MCP configuration is stored in `.cursor/mcp.json`. When `--yolo` mode is active, `--approve-mcps` is also passed to auto-approve MCP server connections.

### Plugin Packaging

Package workspace artifacts as a distributable Cursor plugin:

```bash
# Build a plugin from the current workspace
/plugin build --name my-plugin --version 1.0.0

# Preview what would be included
/plugin info
```

The build process copies rules, skills, agents, and MCP config (with env var sanitization) into a distributable directory with a `plugin.json` manifest.

### Steering & Reflection

CureClaw v0.7 adds three interconnected features for multi-step workflows:

**Steering Queues** — Type while the agent is streaming to queue follow-up prompts. They auto-feed after completion, all within the same Cursor session.

```bash
# In CLI: type while agent streams
> explain the auth module
[agent is responding...]
> now refactor it to use JWT     # queued automatically
> add tests for the new code     # queued automatically
```

**Reflection Loop** — Optional verification pass after execution. The agent reviews its own output and either confirms "LGTM" or fixes issues.

```bash
# Per-job reflection
/schedule "check system health" every 1h --reflect

# Programmatic
await agent.prompt("refactor auth", { reflect: true });
```

**Prompt Pipelines** — Chain prompts as sequential steps executed in a single session.

```bash
# Multi-step pipeline
/pipeline "write a hello world server" --reflect "add error handling" "add tests"

# Template interpolation
/pipeline "list all TODO comments" "fix the issues from: {{prev}}"
```

### Job Scheduler

Schedule recurring or one-shot jobs from any channel (CLI, Telegram, WhatsApp):

```bash
# Schedule a job that runs every hour
/schedule "check system health" every 1h

# Schedule a one-shot job at a specific time
/schedule "generate weekly report" at 2026-03-07T09:00:00Z

# Schedule a weekday job using cron
/schedule "morning standup summary" cron 0 9 * * 1-5

# Schedule with cloud mode
/schedule "run integration tests" every 4h --cloud

# List all jobs
/jobs

# Cancel a job by ID prefix
/cancel a3f2
```

Schedule formats:
- `every <N><s|m|h|d>` — interval (e.g., `every 30m`, `every 4h`)
- `at <ISO8601>` — one-shot at a specific time (auto-disables after execution)
- `cron <5-field>` — standard 5-field cron (minute hour day month weekday)

When scheduled from a channel (Telegram/WhatsApp), results are delivered back to the originating chat. CLI jobs store results in the database.

Error handling: failed jobs use exponential backoff (30s, 1m, 5m, 15m, 60m) before retrying.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PATH` | `cursor` | Path to the Cursor CLI binary |
| `CURSOR_API_KEY` | — | API key for Cursor Cloud Agent API |
| `CURECLAW_DATA_DIR` | `~/.cureclaw` | Directory for SQLite database |
| `CURECLAW_WORKSPACE` | `~/.cureclaw/workspace` | Working directory for channel agents |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token (required for `--telegram`) |
| `TELEGRAM_ALLOWED_USERS` | allow all | Comma-separated Telegram user IDs |
| `WHATSAPP_ALLOWED_JIDS` | allow all | Comma-separated WhatsApp JIDs |
| `WHATSAPP_TRIGGER` | — | Trigger word for group messages (e.g., `@CureClaw`) |
| `WHATSAPP_BOT_NAME` | — | Name prefix for outgoing messages |

## Architecture

```
src/
├── index.ts               Entry point, CLI/Telegram/WhatsApp/one-shot dispatch, DB init
├── cli.ts                 Interactive readline CLI with ANSI rendering + slash commands
├── agent.ts               High-level Agent class with DB persistence + sessionKey
├── agent-loop.ts          Cursor event → AgentEvent translation layer
├── cursor-client.ts       Subprocess wrapper for `cursor agent` (local or SSH, --resume, --cloud)
├── workstation.ts         Name validation, resolveWorkstation()
├── workstation-commands.ts  /workstation add|remove|list|default|status
├── db.ts                  SQLite schema, init, session/config/history/jobs/workstations accessors
├── event-stream.ts        Generic async iterable event stream
├── steering.ts            SteeringQueue — FIFO follow-up prompt buffer
├── reflection.ts          Reflection prompt template + pass/fail detection
├── pipeline.ts            Pipeline parsing + template interpolation
├── types.ts               All type definitions
├── channels/
│   ├── channel.ts         Minimal Channel interface (start/stop)
│   ├── telegram.ts        Telegram bot (grammY, one Agent per chat)
│   └── whatsapp.ts        WhatsApp bot (Baileys, QR auth, one Agent per JID)
├── scheduler/
│   ├── parse-schedule.ts       Parse schedule strings (at/every/cron)
│   ├── compute-next-run.ts     Compute next run time for all schedule kinds
│   ├── delivery.ts             Delivery handler registry (channels register on start)
│   ├── commands.ts             Shared /schedule, /jobs, /cancel command handlers
│   └── scheduler.ts            Timer loop: check due jobs, execute, deliver, re-arm
├── cloud/
│   ├── types.ts           Cloud API request/response types
│   ├── client.ts          CloudClient class (native fetch, Basic auth)
│   └── commands.ts        /cloud launch|status|stop|list|conversation|models
├── skills/
│   ├── scaffold.ts        Generate skill dir + SKILL.md template
│   ├── list.ts            Discover skills from standard paths
│   └── commands.ts        /skill create, /skills
├── mcp/
│   ├── config.ts          Read/write .cursor/mcp.json
│   └── commands.ts        /mcp list|add|remove
└── plugin/
    ├── manifest.ts        Generate plugin.json manifest
    ├── build.ts           Assemble plugin from workspace artifacts
    └── commands.ts        /plugin build|info
```

### Layer Diagram

```
┌─────────────────────────────────────────────┐
│  CLI / Telegram / WhatsApp / Your App       │
│  Subscribes to AgentEvents, renders output  │
├──────────────────────┬──────────────────────┤
│  Scheduler           │  Delivery Registry   │
│  Timer loop, backoff │  Channel handlers    │
├──────────────────────┴──────────────────────┤
│  Agent                                      │
│  State management, DB persistence, resume   │
├──────────────────────┬──────────────────────┤
│  Agent Loop          │  SQLite (db.ts)      │
│  CursorEvent →       │  sessions, history,  │
│  AgentEvent          │  config, jobs        │
├──────────────────────┴──────────────────────┤
│  Cursor Client                              │
│  Spawns subprocess (local or SSH)           │
│  --resume, --cloud, workstation routing     │
├─────────────────────────────────────────────┤
│  Cursor CLI (local or remote via SSH)       │
│  cursor agent --print --output-format ...   │
└─────────────────────────────────────────────┘
```

### Data Flow

1. **Cursor Client** (`cursor-client.ts`) spawns `cursor agent` as a child process with `--output-format stream-json`. It reads stdout line-by-line and exposes an async iterable of raw JSON strings.

2. **Agent Loop** (`agent-loop.ts`) consumes those lines, parses each as a `CursorStreamEvent`, and translates it into one or more `AgentEvent`s pushed onto an `EventStream`.

3. **Agent** (`agent.ts`) wraps the loop with state tracking. It updates internal state on each event (session ID, model, accumulated text, pending tool calls) and emits events to all subscribers.

4. **CLI** (`cli.ts`) subscribes to events and renders them to the terminal with ANSI colors: dim for metadata/thinking, yellow for tools, red for errors, green for success.

## Event System

### AgentEvent Types

CureClaw emits a flat, discriminated union of events. Every event has a `type` field.

#### Lifecycle Events

| Event | Fields | When |
|-------|--------|------|
| `agent_start` | `sessionId`, `model` | Cursor process initialized |
| `agent_end` | `sessionId`, `result`, `usage`, `durationMs` | Cursor process completed |
| `error` | `message` | Any error occurred |

#### Turn Events

| Event | Fields | When |
|-------|--------|------|
| `turn_start` | — | First assistant output or tool call in a turn |
| `turn_end` | — | Cursor emits its result event |

#### Message Events

| Event | Fields | When |
|-------|--------|------|
| `message_start` | — | Assistant begins generating text |
| `message_delta` | `text` | Incremental text chunk (streaming) |
| `message_end` | `text` | Final complete message text |

#### Thinking Events

| Event | Fields | When |
|-------|--------|------|
| `thinking_delta` | `text` | Incremental reasoning chunk |
| `thinking_end` | — | Reasoning phase complete |

#### Tool Events

| Event | Fields | When |
|-------|--------|------|
| `tool_start` | `callId`, `toolName`, `description`, `args` | Cursor begins a tool call |
| `tool_end` | `callId`, `toolName`, `success`, `result` | Tool call completed |

### Event Sequence

A typical prompt produces this event sequence:

```
agent_start
  thinking_delta  (0..n)
  thinking_end
  turn_start
    message_start
      message_delta  (0..n)
    message_end
    tool_start       (0..n tool calls)
    tool_end
    message_start    (agent responds after tool)
      message_delta
    message_end
  turn_end
agent_end
```

### Subscribing to Events

```typescript
import { Agent } from "./agent.js";

const agent = new Agent({ cursorPath: "cursor" });

// Subscribe returns an unsubscribe function
const unsub = agent.subscribe((event) => {
  switch (event.type) {
    case "message_delta":
      process.stdout.write(event.text);
      break;
    case "tool_start":
      console.log(`Running: ${event.toolName}`);
      break;
    case "agent_end":
      console.log(`Done in ${event.durationMs}ms`);
      break;
  }
});

await agent.prompt("What files are in this directory?");
unsub();
```

## Programmatic API

### `Agent`

The main entry point for programmatic use.

```typescript
import { Agent } from "./agent.js";
import type { CursorAgentConfig } from "./types.js";

const config: CursorAgentConfig = {
  cursorPath: "cursor",       // Path to cursor binary
  model: "sonnet-4",          // Optional model override
  cwd: "/path/to/project",    // Working directory
  autoApprove: true,          // --yolo flag
  cloud: false,               // --cloud flag for cloud mode
  streamPartialOutput: true,  // --stream-partial-output flag
  extraArgs: [],               // Additional CLI args
};

const agent = new Agent(config);

// With persistence (auto-resume sessions from DB)
const agentWithDb = new Agent(config, { useDb: true });
```

#### `agent.prompt(text: string): Promise<void>`

Send a prompt to the agent. Resolves when the agent finishes. Throws if the agent is already processing a prompt.

```typescript
await agent.prompt("Refactor the auth module");
```

#### `agent.subscribe(fn): () => void`

Register an event listener. Returns an unsubscribe function.

```typescript
const unsub = agent.subscribe((event) => { /* ... */ });
// Later:
unsub();
```

#### `agent.abort(): void`

Cancel the current prompt. Sends SIGTERM to the Cursor process, followed by SIGKILL after 3 seconds if it doesn't exit.

```typescript
agent.abort();
```

#### `agent.newSession(): void`

Clear the stored session for the current working directory. The next `prompt()` call will start a fresh Cursor session.

```typescript
agent.newSession();
```

#### `agent.state: AgentState`

Read-only access to current agent state.

```typescript
interface AgentState {
  sessionId: string | null;        // Current Cursor session ID
  model: string;                   // Active model name
  isStreaming: boolean;             // True while processing a prompt
  thinkingText: string;            // Accumulated thinking text
  messageText: string;             // Accumulated message text
  pendingToolCalls: Set<string>;   // Tool call IDs in progress
  error: string | null;            // Last error message
  queueDepth: number;              // Number of queued follow-up prompts
}
```

### `agentLoop(prompt, config, signal?)`

Lower-level function that returns an `EventStream` directly, without the `Agent` wrapper.

```typescript
import { agentLoop } from "./agent-loop.js";

const stream = agentLoop("What is 2+2?", config);

for await (const event of stream) {
  console.log(event.type, event);
}

const finalEvent = await stream.result();
```

### `EventStream<T, R>`

Generic async iterable with push-based production and pull-based consumption.

```typescript
import { EventStream } from "./event-stream.js";

const stream = new EventStream<MyEvent, MyResult>(
  (event) => event.type === "done",    // completion predicate
  (event) => event.result,             // result extractor
);

// Producer side
stream.push({ type: "data", value: 42 });
stream.push({ type: "done", result: "finished" });

// Consumer side
for await (const event of stream) {
  console.log(event);
}

const result = await stream.result(); // "finished"
```

### `spawnCursor(prompt, config, signal?)`

Low-level subprocess wrapper. Returns the raw child process, an async line iterator, and a stderr accessor.

```typescript
import { spawnCursor, parseCursorEvent } from "./cursor-client.js";

const cursor = spawnCursor("Hello", config);

for await (const line of cursor.lines) {
  const event = parseCursorEvent(line);
  if (event) console.log(event);
}
```

## Cursor CLI Event Translation

CureClaw translates Cursor's `stream-json` output format into `AgentEvent`s. Here is the mapping:

| Cursor Event | Condition | AgentEvent(s) |
|---|---|---|
| `{"type":"system","subtype":"init",...}` | — | `agent_start` |
| `{"type":"user",...}` | — | *(ignored — echo)* |
| `{"type":"thinking","subtype":"delta",...}` | — | `thinking_delta` |
| `{"type":"thinking","subtype":"completed",...}` | — | `thinking_end` |
| `{"type":"assistant",...}` | has `timestamp_ms` | `message_delta` |
| `{"type":"assistant",...}` | no `timestamp_ms` | `message_end` |
| `{"type":"tool_call","subtype":"started",...}` | — | `tool_start` |
| `{"type":"tool_call","subtype":"completed",...}` | — | `tool_end` |
| `{"type":"result","subtype":"success",...}` | — | `turn_end` + `agent_end` |
| `{"type":"result","subtype":"error",...}` | — | `turn_end` + `error` |

### Tool Name Extraction

Cursor's tool call payloads are polymorphic — the key name indicates the tool type:

```json
{"tool_call": {"shellToolCall": {...}}}      → toolName: "shell"
{"tool_call": {"fileEditToolCall": {...}}}    → toolName: "fileEdit"
{"tool_call": {"readToolCall": {...}}}        → toolName: "read"
```

CureClaw extracts the tool name by finding the first key ending in `ToolCall` and stripping the suffix.

## Project Configuration

### `package.json`

Five runtime dependencies — persistence, Telegram, and WhatsApp:

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "^7.0.0-rc.9",
    "better-sqlite3": "^11.8.0",
    "grammy": "^1.35.0",
    "pino": "^9.6.0",
    "qrcode-terminal": "^0.12.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.10.0",
    "@types/qrcode-terminal": "^0.12.2",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

### `tsconfig.json`

ES2022 target with NodeNext module resolution for native ES module support:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true
  }
}
```

### Build & Run

```bash
npm run build    # Compile TypeScript → dist/
npm run start    # Run compiled output
npm run dev      # Run directly with tsx (no build step)
npm test         # Run tests
```

## Design Decisions

**Why wrap Cursor CLI instead of calling APIs directly?**
Cursor CLI handles model selection, tool execution, permission management, context windows, and multi-turn reasoning. Reimplementing all of that would be thousands of lines of code. By wrapping the CLI, CureClaw inherits all of Cursor's capabilities with ~300 lines of glue code.

**Why the Pi-Mono event pattern?**
Pi-Mono's `agentLoop()` is the cleanest event-driven agent pattern in the open-source ecosystem. Its discriminated union of events (`agent_start`, `message_delta`, `tool_start`, etc.) maps naturally to Cursor's stream-json output and provides a familiar interface for anyone building on top.

**Why better-sqlite3?**
Session persistence requires a database. better-sqlite3 is synchronous (no async ceremony), fast, and battle-tested.

**Why grammY for Telegram?**
TypeScript-first, modern, lightweight, zero native dependencies. Simpler and lighter than telegraf.

**Why Baileys for WhatsApp?**
The most maintained open-source WhatsApp Web library for Node.js. Provides full WhatsApp Web protocol support without requiring the official Business API, making it ideal for personal assistant use.

**Why one session per working directory / chat?**
Simplest model that works — CLI sessions keyed by cwd, Telegram sessions keyed by chat ID. Named sessions and multi-session-per-key can be added later without breaking the schema.

**Why one process per prompt?**
Cursor CLI's `--print` mode is one-shot: pass a prompt, get results, process exits. Session continuity is achieved via `--resume <chatId>`, which Cursor supports natively.

## Roadmap

- [x] Session continuity (store session IDs, use `--resume` for multi-turn)
- [x] SQLite state persistence
- [x] Telegram channel
- [x] WhatsApp channel
- [x] Cloud mode (`--cloud` for Cursor cloud agents)
- [x] Job scheduler (cron/interval/one-shot with delivery pipeline)
- [x] Cloud Agent API (native REST client, scheduler integration)
- [x] Skills (scaffolding + discovery from standard paths)
- [x] MCP server configuration (.cursor/mcp.json management)
- [x] Plugin packaging (build distributable from workspace artifacts)

### v0.7 — Steering & Reflection
- [x] **Steering queues** — queue follow-up prompts while agent streams; auto-feed next prompt on turn completion (Pi-Mono's full loop pattern)
- [x] **Reflection loop** — optional post-execution verification pass ("review your output for errors") before delivering results
- [x] **Prompt pipelines** — chain prompts as steps: "do X → then Y → then verify Z" executed as a single unit

### v0.8 — Multi-Workstation Support
- [x] **Workstation registry** — register remote dev servers/VMs with SSH connection details
- [x] **SSH remote execution** — `spawn("ssh", ...)` instead of `spawn("cursor", ...)`, NDJSON streaming unchanged
- [x] **`@name` prefix** — target a specific workstation per-prompt from any channel
- [x] **`--workstation` flag** — set default workstation for all prompts in a session
- [x] **Scheduler integration** — `--workstation <name>` on scheduled jobs
- [x] **Per-workstation sessions** — session keys prefixed with `ws:<name>:` for isolation

### v0.9 — Event-Driven Autonomy
- [ ] **Webhook triggers** — HTTP endpoint that accepts external signals (GitHub, CI/CD, monitoring) and spawns agent jobs
- [ ] **File watchers** — trigger agent when workspace files change (new logs, build failures, git events)
- [ ] **Conditional chains** — "when job A finishes with status X, run job B" (job dependency graph)
- [ ] **Inactivity triggers** — "if no commit in N hours, run code review" (pattern-based scheduling)
- [ ] **Continuous context injection** — auto-inject recent git diff, failing tests, open issues before each prompt

### v0.10 — Multi-Agent Orchestration
- [ ] **Planner agent** — decomposes high-level goals into subtask tree
- [ ] **Worker agents** — execute subtasks in parallel using existing Agent class
- [ ] **Inter-agent messaging** — shared DB queue for agent-to-agent communication
- [ ] **Aggregator** — collects worker results, feeds back to planner for next iteration
- [ ] **Goal decomposition** — accept "make auth production-ready" → lint → test → fix → verify

### v1.0 — General-Purpose Personal Assistant
- [ ] **Beyond coding** — weather, calendar, appointments, email, reminders via MCP servers and tool integrations
- [ ] **Proactive suggestions** — agent monitors context and proposes actions ("you have a meeting in 30 min, want me to prep notes?")
- [ ] **Long-term memory** — persistent user preferences, habits, and patterns that inform autonomous decisions
- [ ] **Approval gates** — draft-and-notify for high-stakes actions (send email, book appointment) with human-in-the-loop confirmation
- [ ] **Cross-domain tool chaining** — combine coding tools with life tools (e.g., "deploy to staging and notify the team on Slack")

## License

MIT
