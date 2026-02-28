# Contributing to CureClaw

## Setup

```bash
git clone <repo-url>
cd cureclaw
npm install
```

Requirements:
- Node.js >= 20
- Cursor CLI installed and available in `$PATH` (or set `CURSOR_PATH`)

## Development Workflow

```bash
# Run directly (no build step)
npm run dev

# Type-check without emitting
npx tsc --noEmit

# Build to dist/
npm run build

# Run built output
npm run start
```

## Project Structure

```
src/
├── types.ts           Type definitions (edit this first when adding features)
├── event-stream.ts    EventStream class (rarely needs changes)
├── cursor-client.ts   Cursor subprocess management
├── agent-loop.ts      Event translation logic
├── agent.ts           Agent class
├── db.ts              SQLite persistence (better-sqlite3)
├── cli.ts             Terminal UI
├── index.ts           Entry point
└── channels/
    ├── channel.ts     Channel interface (start/stop)
    ├── telegram.ts    Telegram bot (grammY)
    └── whatsapp.ts    WhatsApp bot (Baileys)
```

## Adding a New AgentEvent Type

1. Add the event variant to the `AgentEvent` union in `src/types.ts`
2. Handle the corresponding `CursorStreamEvent` in `translateEvent()` in `src/agent-loop.ts`
3. Update state tracking in `Agent.updateState()` in `src/agent.ts`
4. Add rendering in `renderEvent()` in `src/cli.ts`

## Adding a New CLI Flag

1. Add the field to `CursorAgentConfig` in `src/types.ts`
2. Parse it in `parseArgs()` in `src/index.ts`
3. Add it to `printUsage()` in `src/index.ts`
4. Wire it into `spawnCursor()` args in `src/cursor-client.ts`

## Adding a New Channel

Channels live in `src/channels/`. See `telegram.ts` and `whatsapp.ts` for reference:

1. Create `src/channels/<name>.ts`
2. Implement the `Channel` interface from `channel.ts` (`start()` / `stop()`)
3. Create one `Agent` per conversation (keyed by `<prefix>:<id>`, e.g., `tg:123`, `wa:jid`)
4. Wire it into the entry point dispatch in `src/index.ts`
5. Keep channels independent of each other

## Code Style

- TypeScript strict mode
- ES modules (use `.js` extensions in imports)
- No runtime dependencies unless absolutely necessary
- Prefer `node:` prefixed built-in imports
- Discriminated unions for event types (always use `type` field)
- No classes where a function suffices; no abstractions for one-time use

## Commit Messages

Use imperative mood, focused on what changed:

```
Add Telegram channel support
Fix tool name extraction for fileEdit calls
Remove hardcoded cursor path
```
