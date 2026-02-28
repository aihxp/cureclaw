#!/usr/bin/env node

import { initDatabase, closeDatabase, clearSession } from "./db.js";
import { startCli } from "./cli.js";
import type { CursorAgentConfig } from "./types.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const DEFAULT_CURSOR_PATH = process.env.CURSOR_PATH ?? "cursor";

interface ParsedArgs extends CursorAgentConfig {
  oneShot?: string;
  newSession?: boolean;
  telegram?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const config: ParsedArgs = {
    cursorPath: DEFAULT_CURSOR_PATH,
    model: undefined,
    cwd: process.cwd(),
    autoApprove: false,
    streamPartialOutput: true,
    newSession: false,
    telegram: false,
  };

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
        config.oneShot = argv[++i];
        break;
      case "--no-stream":
        config.streamPartialOutput = false;
        break;
      case "--new":
        config.newSession = true;
        break;
      case "--telegram":
        config.telegram = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  return config;
}

function printUsage(): void {
  console.log(`CureClaw v0.3 — Cursor CLI agent with session persistence

Usage:
  cureclaw [options]              Interactive mode
  cureclaw -p "prompt"            One-shot mode
  cureclaw --telegram             Telegram bot mode

Options:
  --model <model>       Model to use (e.g., sonnet-4, gpt-5)
  --yolo, --force       Auto-approve all tool calls
  --cwd <dir>           Working directory for cursor agent
  --cursor-path <path>  Path to cursor CLI binary
  --no-stream           Disable partial output streaming
  --new                 Start a fresh session (clear saved session for cwd)
  --telegram            Start as a Telegram bot (requires TELEGRAM_BOT_TOKEN)
  -p, --prompt <text>   Run a single prompt and exit
  -h, --help            Show this help

Environment:
  CURSOR_PATH             Path to cursor CLI binary
  CURECLAW_DATA_DIR       Directory for SQLite database (~/.cureclaw)
  TELEGRAM_BOT_TOKEN      Telegram bot token (required for --telegram)
  TELEGRAM_ALLOWED_USERS  Comma-separated Telegram user IDs (optional)
  CURECLAW_WORKSPACE      Working directory for Telegram agents (~/.cureclaw/workspace)
`);
}

async function main(): Promise<void> {
  const { oneShot, newSession, telegram, ...config } = parseArgs(
    process.argv.slice(2),
  );

  // Init persistence
  initDatabase();

  // Clear session if --new flag is set
  if (newSession) {
    clearSession(path.resolve(config.cwd || process.cwd()));
  }

  if (telegram) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error(
        "Fatal: TELEGRAM_BOT_TOKEN environment variable is required for --telegram mode",
      );
      process.exit(1);
    }

    const allowedUsersEnv = process.env.TELEGRAM_ALLOWED_USERS;
    const allowedUsers = allowedUsersEnv
      ? new Set(
          allowedUsersEnv
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n)),
        )
      : undefined;

    const workspace =
      process.env.CURECLAW_WORKSPACE ??
      path.join(os.homedir(), ".cureclaw", "workspace");
    fs.mkdirSync(workspace, { recursive: true });

    const { TelegramChannel } = await import("./channels/telegram.js");
    const channel = new TelegramChannel({
      token,
      allowedUsers,
      workspace,
      cursorConfig: { ...config, cwd: workspace },
    });

    process.once("SIGINT", () => channel.stop());
    process.once("SIGTERM", () => channel.stop());

    await channel.start();
  } else if (oneShot) {
    // One-shot mode: run a single prompt and exit
    const { Agent } = await import("./agent.js");
    const agent = new Agent(config, { useDb: true });
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
    closeDatabase();
  } else {
    await startCli(config);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  closeDatabase();
  process.exit(1);
});
