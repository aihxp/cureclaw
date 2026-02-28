# CureClaw

Personal AI assistant that wraps Cursor CLI as a subprocess with a Pi-Mono-style event-driven agent loop.

## Quick Context

Single TypeScript process. Spawns `cursor agent --print --output-format stream-json --trust` as a child process, parses NDJSON stdout line-by-line, translates Cursor events into AgentEvents, and streams them to subscribers. Zero runtime dependencies.

## Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | All type definitions: Cursor stream types + AgentEvent types + config |
| `src/event-stream.ts` | Generic async iterable EventStream (adapted from pi-mono) |
| `src/cursor-client.ts` | Spawns cursor subprocess, provides async line iterator |
| `src/agent-loop.ts` | Translates CursorStreamEvent → AgentEvent, manages turn/message state |
| `src/agent.ts` | High-level Agent class: subscribe/prompt/abort with state tracking |
| `src/cli.ts` | Interactive readline CLI with ANSI color rendering |
| `src/index.ts` | Entry point, CLI argument parsing |

## Architecture

```
CLI / App  →  Agent  →  agentLoop()  →  spawnCursor()  →  cursor agent (subprocess)
     ↑           ↑           ↑
  renders    state mgmt   event translation
  events     subscribe()  CursorEvent → AgentEvent
```

## Event Flow

Cursor emits NDJSON on stdout → parsed in cursor-client → translated in agent-loop → pushed to EventStream → consumed by Agent → emitted to subscribers.

Event types: `agent_start`, `thinking_delta`, `thinking_end`, `turn_start`, `message_start`, `message_delta`, `message_end`, `tool_start`, `tool_end`, `turn_end`, `agent_end`, `error`.

## Development

```bash
npm run dev      # Run with tsx (no build)
npm run build    # Compile TypeScript
npm run start    # Run compiled output
```

## Conventions

- TypeScript strict mode, ES modules with `.js` imports
- Zero runtime dependencies — Node.js built-ins only
- No over-engineering: each file has one job
- Tool name extraction: find key ending in `ToolCall`, strip suffix
- Partial vs final assistant messages: `timestamp_ms` present = delta, absent = final
