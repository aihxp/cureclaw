import path from "node:path";
import * as readline from "node:readline";
import { Agent } from "./agent.js";
import { getSession, getAllSessions, getHistory } from "./db.js";
import type { AgentEvent, CursorAgentConfig } from "./types.js";

// ANSI helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function startCli(config: CursorAgentConfig): Promise<void> {
  const agent = new Agent(config, { useDb: true });
  const cwd = path.resolve(config.cwd || process.cwd());

  // Session banner
  const saved = getSession(cwd);
  if (saved) {
    console.log(
      bold("CureClaw v0.2") + dim(` (cursor ${config.model ?? "auto"})`),
    );
    console.log(
      dim(
        `Resuming session ${saved.session_id.slice(0, 8)}... (${formatTimeAgo(saved.updated_at)})`,
      ),
    );
  } else {
    console.log(
      bold("CureClaw v0.2") + dim(` (cursor ${config.model ?? "auto"})`),
    );
    console.log(dim("New session"));
  }
  console.log(dim("Type /help for commands. Ctrl+C to exit.\n"));

  agent.subscribe(renderEvent);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: cyan("> "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      handleCommand(trimmed, agent, cwd);
      rl.prompt();
      return;
    }

    try {
      await agent.prompt(trimmed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`Error: ${msg}`));
    }

    console.log();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(dim("\nGoodbye."));
    process.exit(0);
  });

  // Ctrl+C: abort if streaming, exit otherwise
  process.on("SIGINT", () => {
    if (agent.state.isStreaming) {
      agent.abort();
    } else {
      rl.close();
    }
  });
}

function handleCommand(cmd: string, agent: Agent, cwd: string): void {
  switch (cmd) {
    case "/new": {
      agent.newSession();
      console.log(green("Session cleared. Next prompt starts fresh."));
      break;
    }

    case "/sessions": {
      const sessions = getAllSessions();
      if (sessions.length === 0) {
        console.log(dim("No saved sessions."));
        break;
      }
      console.log(bold("Saved sessions:\n"));
      for (const s of sessions) {
        const marker = s.cwd === cwd ? cyan(" ←") : "";
        console.log(
          `  ${s.session_id.slice(0, 8)}  ${dim(formatTimeAgo(s.updated_at))}  ${s.cwd}${marker}`,
        );
        if (s.last_prompt) {
          console.log(dim(`    "${s.last_prompt.slice(0, 60)}"`));
        }
      }
      console.log();
      break;
    }

    case "/history": {
      const entries = getHistory(cwd, 10);
      if (entries.length === 0) {
        console.log(dim("No history for this directory."));
        break;
      }
      console.log(bold("Recent prompts:\n"));
      for (const h of entries) {
        const tokens = h.input_tokens && h.output_tokens
          ? dim(` [${h.input_tokens}in/${h.output_tokens}out]`)
          : "";
        const dur = h.duration_ms ? dim(` ${h.duration_ms}ms`) : "";
        console.log(
          `  ${dim(formatTimeAgo(h.created_at))} ${h.prompt.slice(0, 70)}${tokens}${dur}`,
        );
      }
      console.log();
      break;
    }

    case "/help": {
      console.log(bold("Commands:\n"));
      console.log("  /new        Clear session, start fresh");
      console.log("  /sessions   List all saved sessions");
      console.log("  /history    Show recent prompts for this directory");
      console.log("  /help       Show this help");
      console.log("  /quit       Exit CureClaw");
      console.log();
      break;
    }

    case "/quit":
    case "/exit":
      process.exit(0);

    default:
      console.log(dim(`Unknown command: ${cmd}. Type /help for commands.`));
  }
}

function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case "agent_start":
      process.stdout.write(
        dim(
          `[session: ${event.sessionId.slice(0, 8)}... model: ${event.model}]\n`,
        ),
      );
      break;

    case "thinking_delta":
      process.stdout.write(dim(event.text));
      break;

    case "thinking_end":
      process.stdout.write("\n");
      break;

    case "message_delta":
      process.stdout.write(event.text);
      break;

    case "message_end":
      if (!event.text.endsWith("\n")) {
        process.stdout.write("\n");
      }
      break;

    case "tool_start": {
      console.log(yellow(`\n[tool: ${event.toolName}] ${event.description}`));
      const cmd = event.args.command;
      if (typeof cmd === "string") {
        console.log(dim(`  $ ${cmd}`));
      }
      break;
    }

    case "tool_end": {
      const status = event.success ? green("ok") : red("failed");
      console.log(yellow(`[tool: ${event.toolName}] ${status}`));
      if (event.result && event.result.length < 500) {
        console.log(dim(event.result));
      }
      break;
    }

    case "agent_end":
      console.log(
        dim(
          `\n[done in ${event.durationMs}ms | tokens: ${event.usage.inputTokens}in/${event.usage.outputTokens}out]`,
        ),
      );
      break;

    case "error":
      console.error(red(`[error] ${event.message}`));
      break;
  }
}
