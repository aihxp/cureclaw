#!/usr/bin/env node

import { startCli } from "./cli.js";
import type { CursorAgentConfig } from "./types.js";

const DEFAULT_CURSOR_PATH = process.env.CURSOR_PATH ?? "cursor";

function parseArgs(argv: string[]): CursorAgentConfig & { oneShot?: string } {
  const config: CursorAgentConfig = {
    cursorPath: DEFAULT_CURSOR_PATH,
    model: undefined,
    cwd: process.cwd(),
    autoApprove: false,
    streamPartialOutput: true,
  };
  let oneShot: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--model":
        config.model = argv[++i];
        break;
      case "--yolo":
      case "--force":
        config.autoApprove = true;
        break;
      case "--cwd":
        config.cwd = argv[++i];
        break;
      case "--cursor-path":
        config.cursorPath = argv[++i];
        break;
      case "--prompt":
      case "-p":
        oneShot = argv[++i];
        break;
      case "--no-stream":
        config.streamPartialOutput = false;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  return { ...config, oneShot };
}

function printUsage(): void {
  console.log(`CureClaw v0.1 — Cursor CLI agent with Pi-style event loop

Usage:
  cureclaw [options]              Interactive mode
  cureclaw -p "prompt"            One-shot mode

Options:
  --model <model>       Model to use (e.g., sonnet-4, gpt-5)
  --yolo, --force       Auto-approve all tool calls
  --cwd <dir>           Working directory for cursor agent
  --cursor-path <path>  Path to cursor CLI binary
  --no-stream           Disable partial output streaming
  -p, --prompt <text>   Run a single prompt and exit
  -h, --help            Show this help
`);
}

async function main(): Promise<void> {
  const { oneShot, ...config } = parseArgs(process.argv.slice(2));

  if (oneShot) {
    // One-shot mode: run a single prompt and exit
    const { Agent } = await import("./agent.js");
    const agent = new Agent(config);
    agent.subscribe((e) => {
      if (e.type === "message_delta") {
        process.stdout.write(e.text);
      }
      if (e.type === "message_end" && !e.text.endsWith("\n")) {
        process.stdout.write("\n");
      }
      if (e.type === "error") {
        process.stderr.write(e.message + "\n");
      }
    });
    await agent.prompt(oneShot);
  } else {
    await startCli(config);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
