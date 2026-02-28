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
CureClaw v0.4 — Cursor CLI agent with session persistence

Usage:
  cureclaw [options]              Interactive mode
  cureclaw -p "prompt"            One-shot mode
  cureclaw --telegram             Telegram bot mode
  cureclaw --whatsapp             WhatsApp mode (Baileys)

Options:
  --model <model>       Model to use (e.g., sonnet-4, gpt-5)
  --yolo, --force       Auto-approve all tool calls
  --cwd <dir>           Working directory for cursor agent
  --cursor-path <path>  Path to cursor CLI binary
  --no-stream           Disable partial output streaming
  --new                 Start a fresh session (clear saved session for cwd)
  --telegram            Start as a Telegram bot (requires TELEGRAM_BOT_TOKEN)
  --whatsapp            Start as a WhatsApp bot (uses Baileys, QR auth)
  -p, --prompt <text>   Run a single prompt and exit
  -h, --help            Show this help
```

### Interactive Commands

| Command | Action |
|---------|--------|
| `/new` | Clear session, start fresh |
| `/sessions` | List all saved sessions |
| `/history` | Show recent prompts for current directory |
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

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_PATH` | `cursor` | Path to the Cursor CLI binary |
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
├── cursor-client.ts       Subprocess wrapper for `cursor agent` (supports --resume)
├── db.ts                  SQLite schema, init, session/config/history accessors
├── event-stream.ts        Generic async iterable event stream
├── types.ts               All type definitions
└── channels/
    ├── channel.ts         Minimal Channel interface (start/stop)
    ├── telegram.ts        Telegram bot (grammY, one Agent per chat)
    └── whatsapp.ts        WhatsApp bot (Baileys, QR auth, one Agent per JID)
```

### Layer Diagram

```
┌─────────────────────────────────────────────┐
│  CLI / Telegram / WhatsApp / Your App       │
│  Subscribes to AgentEvents, renders output  │
├─────────────────────────────────────────────┤
│  Agent                                      │
│  State management, DB persistence, resume   │
├──────────────────────┬──────────────────────┤
│  Agent Loop          │  SQLite (db.ts)      │
│  CursorEvent →       │  sessions, history,  │
│  AgentEvent          │  config              │
├──────────────────────┴──────────────────────┤
│  Cursor Client                              │
│  Spawns subprocess, --resume, NDJSON parse  │
├─────────────────────────────────────────────┤
│  Cursor CLI (external binary)               │
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
- [ ] Steering and follow-up queues (Pi's full loop pattern)
- [ ] Container-based agent isolation
- [ ] Multi-agent orchestration

## License

MIT
