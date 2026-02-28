#!/usr/bin/env node

import { initDatabase, closeDatabase, clearSession } from "./db.js";
import { Scheduler } from "./scheduler/scheduler.js";
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
  whatsapp?: boolean;
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
    whatsapp: false,
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
      case "--whatsapp":
        config.whatsapp = true;
        break;
      case "--cloud":
        config.cloud = true;
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
  console.log(`CureClaw v0.6 — Cursor CLI agent with Cloud API, skills, MCP, and plugin support

Usage:
  cureclaw [options]              Interactive mode
  cureclaw -p "prompt"            One-shot mode
  cureclaw --telegram             Telegram bot mode
  cureclaw --whatsapp             WhatsApp mode (Baileys)

Options:
  --model <model>       Model to use (e.g., sonnet-4, gpt-5)
  --yolo, --force       Auto-approve all tool calls
  --cloud               Run Cursor agent in cloud mode
  --cwd <dir>           Working directory for cursor agent
  --cursor-path <path>  Path to cursor CLI binary
  --no-stream           Disable partial output streaming
  --new                 Start a fresh session (clear saved session for cwd)
  --telegram            Start as a Telegram bot (requires TELEGRAM_BOT_TOKEN)
  --whatsapp            Start as a WhatsApp bot (uses Baileys, QR auth)
  -p, --prompt <text>   Run a single prompt and exit
  -h, --help            Show this help

Scheduler commands (CLI, Telegram, WhatsApp):
  /schedule "prompt" <schedule> [--cloud] [--repo <url>]
  /jobs                 List all scheduled jobs
  /cancel <id-prefix>   Remove a scheduled job

Cloud commands:
  /cloud launch "prompt" <repo-url> [--model <m>] [--pr]
  /cloud status <id>    Get agent status
  /cloud stop <id>      Stop a running agent
  /cloud list           List recent agents
  /cloud conversation <id>   Get agent transcript
  /cloud models         List available models

Skill commands:
  /skill create <name>  Scaffold a new skill
  /skills               List discovered skills

MCP commands:
  /mcp list             List configured MCP servers
  /mcp add <name> <command> [args]   Add an MCP server
  /mcp remove <name>    Remove an MCP server

Plugin commands:
  /plugin build         Build a distributable plugin
  /plugin info          Show what would be included

Schedule formats:
  every <N><s|m|h|d>    e.g., every 30m, every 4h
  at <ISO8601>          e.g., at 2026-03-01T09:00:00Z
  cron <5-field>        e.g., cron 0 9 * * 1-5

Environment:
  CURSOR_PATH             Path to cursor CLI binary
  CURSOR_API_KEY          API key for Cursor Cloud Agent API
  CURECLAW_DATA_DIR       Directory for SQLite database (~/.cureclaw)
  TELEGRAM_BOT_TOKEN      Telegram bot token (required for --telegram)
  TELEGRAM_ALLOWED_USERS  Comma-separated Telegram user IDs (optional)
  CURECLAW_WORKSPACE      Working directory for channel agents (~/.cureclaw/workspace)
  WHATSAPP_ALLOWED_JIDS   Comma-separated WhatsApp JIDs (optional)
  WHATSAPP_TRIGGER        Trigger word for group messages (e.g., @CureClaw)
  WHATSAPP_BOT_NAME       Name prefix for outgoing messages (optional)
`);
}

async function main(): Promise<void> {
  const { oneShot, newSession, telegram, whatsapp, ...config } = parseArgs(
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

    const scheduler = new Scheduler({ ...config, cwd: workspace });
    scheduler.start();

    process.once("SIGINT", () => { scheduler.stop(); channel.stop(); });
    process.once("SIGTERM", () => { scheduler.stop(); channel.stop(); });

    await channel.start();
  } else if (whatsapp) {
    const workspace =
      process.env.CURECLAW_WORKSPACE ??
      path.join(os.homedir(), ".cureclaw", "workspace");
    fs.mkdirSync(workspace, { recursive: true });

    const authDir = path.join(os.homedir(), ".cureclaw", "whatsapp-auth");
    fs.mkdirSync(authDir, { recursive: true });

    const allowedJidsEnv = process.env.WHATSAPP_ALLOWED_JIDS;
    const allowedJids = allowedJidsEnv
      ? new Set(
          allowedJidsEnv
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : undefined;

    const triggerWord = process.env.WHATSAPP_TRIGGER || undefined;
    const botName = process.env.WHATSAPP_BOT_NAME || undefined;

    const { WhatsAppChannel } = await import("./channels/whatsapp.js");
    const channel = new WhatsAppChannel({
      authDir,
      workspace,
      allowedJids,
      triggerWord,
      botName,
      cursorConfig: { ...config, cwd: workspace },
    });

    const scheduler = new Scheduler({ ...config, cwd: workspace });
    scheduler.start();

    process.once("SIGINT", () => { scheduler.stop(); channel.stop(); });
    process.once("SIGTERM", () => { scheduler.stop(); channel.stop(); });

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
    const scheduler = new Scheduler(config);
    scheduler.start();
    await startCli(config);
    scheduler.stop();
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  closeDatabase();
  process.exit(1);
});
