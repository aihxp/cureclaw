import * as readline from "node:readline";
import { Agent } from "./agent.js";
import type { AgentEvent, CursorAgentConfig } from "./types.js";

// ANSI helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

export async function startCli(config: CursorAgentConfig): Promise<void> {
  const agent = new Agent(config);

  console.log(
    bold("CureClaw v0.1") + dim(` (cursor ${config.model ?? "auto"})`),
  );
  console.log(dim("Type your prompt. Ctrl+C to exit.\n"));

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

    if (trimmed === "/quit" || trimmed === "/exit") {
      rl.close();
      process.exit(0);
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
