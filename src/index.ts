#!/usr/bin/env node

import { initDatabase, closeDatabase, clearSession } from "./db.js";
import { isValidMode } from "./mode.js";
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
  workstationFlag?: string;
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
      case "--workstation":
        config.workstationFlag = argv[++i];
        break;
      case "--mode": {
        const m = argv[++i];
        if (m && isValidMode(m)) {
          config.mode = m;
        }
        break;
      }
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  return config;
}

async function startTriggerServer(config: CursorAgentConfig): Promise<{ stop: () => Promise<void> } | null> {
  const portEnv = process.env.CURECLAW_WEBHOOK_PORT;
  if (!portEnv) return null;

  const { WebhookServer } = await import("./webhook/server.js");
  const server = new WebhookServer({
    port: parseInt(portEnv, 10),
    secret: process.env.CURECLAW_WEBHOOK_SECRET,
    triggerSecret: process.env.CURECLAW_TRIGGER_SECRET,
  });

  const { processEvent } = await import("./trigger/engine.js");

  // Trigger webhook: POST /trigger/:name
  server.subscribeTrigger((event) => {
    processEvent({ kind: "webhook", name: event.name, payload: event.payload }, config)
      .catch((err) => console.error(`[trigger] Error processing webhook "${event.name}":`, err));
  });

  // Cloud status changes → cloud_complete triggers
  server.subscribe((event) => {
    processEvent({ kind: "cloud_complete", agentId: event.agentId, status: event.status, summary: event.summary }, config)
      .catch((err) => console.error(`[trigger] Error processing cloud_complete:`, err));
  });

  const assignedPort = await server.start();
  console.log(`[trigger] Server listening on port ${assignedPort}`);

  return { stop: () => server.stop() };
}

function printUsage(): void {
  console.log(`CureClaw v0.11 — Cursor ecosystem orchestration platform

Usage:
  cureclaw [options]              Interactive mode
  cureclaw -p "prompt"            One-shot mode
  cureclaw --telegram             Telegram bot mode
  cureclaw --whatsapp             WhatsApp mode (Baileys)

Options:
  --model <model>           Model to use (e.g., sonnet-4, gpt-5)
  --mode <mode>             Agent mode: agent (default), plan, or ask
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

Mode prefixes (in prompts):
  ?question                 Run in ask mode (read-only Q&A)
  !instruction              Run in plan mode (read-only analysis)

Workstation commands:
  /workstation list                           List registered workstations
  /workstation add <name> <user@host> <cwd>   Register a workstation
  /workstation remove <name>                  Remove a workstation
  /workstation default <name|local>           Set default workstation
  /workstation status <name>                  Test SSH connectivity
  @name <prompt>                              Run prompt on a workstation

Scheduler commands (CLI, Telegram, WhatsApp):
  /schedule "prompt" <schedule> [--cloud] [--reflect] [--repo <url>] [--workstation <name>]
  /jobs                 List all scheduled jobs
  /cancel <id-prefix>   Remove a scheduled job

Pipeline commands:
  /pipeline "step1" [--reflect] "step2"   Multi-step prompt pipeline

Cloud commands:
  /cloud launch "prompt" <repo-url> [--model <m>] [--pr]
  /cloud steer "prompt" <repo-url> [--model <m>] [--max <n>]
  /cloud status <id>    Get agent status
  /cloud stop <id>      Stop a running agent
  /cloud list           List recent agents
  /cloud conversation <id>   Get agent transcript
  /cloud models         List available models

Mode commands:
  /mode <agent|plan|ask>  Switch agent mode

Fleet commands:
  /fleet launch <repo> "task1" "task2" ... [--model m] [--pr]
  /fleet status <id>    Show fleet status
  /fleet stop <id>      Stop all fleet agents
  /fleet list           List recent fleets

Orchestration commands:
  /orchestrate "goal" [--cloud] [--repo <url>] [--model m] [--workers N]

Agent run commands:
  /runs [--active]      List recent agent runs
  /run info <id>        Show run details

Trigger commands:
  /trigger add webhook <name> "prompt" [--context ...] [--cloud] [--reflect]
  /trigger add job-chain <id-prefix> <success|error|any> "prompt" [options]
  /trigger add cloud-complete <status|any> "prompt" [options]
  /trigger list           List all triggers
  /trigger remove <id>    Remove a trigger
  /trigger enable <id>    Enable a trigger
  /trigger disable <id>   Disable a trigger
  /trigger info <id>      Show trigger details

Hooks commands:
  /hooks list             List configured hooks
  /hooks add <event> <command> [args]   Add a hook
  /hooks remove <event> <command>       Remove a hook

Subagent commands:
  /agents               List discovered subagents
  /agent create <name>  Scaffold a new subagent

Custom commands:
  /commands             List discovered commands
  /run <name> [args]    Run a custom command

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
  CURECLAW_WEBHOOK_PORT   Port for webhook HTTP server (0 = auto-assign)
  CURECLAW_WEBHOOK_URL    External webhook URL (for tunnels/proxies)
  CURECLAW_WEBHOOK_SECRET HMAC secret for webhook verification (auto-generated)
  CURECLAW_TRIGGER_SECRET Optional shared secret for /trigger/:name endpoint
`);
}

async function main(): Promise<void> {
  const { oneShot, newSession, telegram, whatsapp, workstationFlag, ...config } = parseArgs(
    process.argv.slice(2),
  );

  // Apply workstation flag to config
  if (workstationFlag) {
    config.workstation = workstationFlag;
  }

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

    const triggerServer = await startTriggerServer({ ...config, cwd: workspace });

    process.once("SIGINT", () => { scheduler.stop(); triggerServer?.stop(); channel.stop(); });
    process.once("SIGTERM", () => { scheduler.stop(); triggerServer?.stop(); channel.stop(); });

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

    const triggerServer = await startTriggerServer({ ...config, cwd: workspace });

    process.once("SIGINT", () => { scheduler.stop(); triggerServer?.stop(); channel.stop(); });
    process.once("SIGTERM", () => { scheduler.stop(); triggerServer?.stop(); channel.stop(); });

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

    const triggerServer = await startTriggerServer(config);

    await startCli(config);
    scheduler.stop();
    await triggerServer?.stop();
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  closeDatabase();
  process.exit(1);
});
