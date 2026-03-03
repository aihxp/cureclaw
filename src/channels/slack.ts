import { Agent } from "../agent.js";
import { handleAgentCommand } from "../agents/commands.js";
import { handleCloudCommand } from "../cloud/commands.js";
import { handleFleetCommand } from "../fleet/commands.js";
import { handleCommandsCommand } from "../commands/commands.js";
import { handleHooksCommand } from "../hooks/commands.js";
import { handleMcpCommand } from "../mcp/commands.js";
import { parseModePrefix } from "../mode.js";
import { handleSchedulerCommand, handlePipelineCommand } from "../scheduler/commands.js";
import { registerDeliveryHandler, unregisterDeliveryHandler } from "../scheduler/delivery.js";
import { handleSkillCommand } from "../skills/commands.js";
import { handleTriggerCommand } from "../trigger/commands.js";
import { handleWorkstationCommand } from "../workstation-commands.js";
import { handleMemoryCommand } from "../memory/commands.js";
import { handleApprovalCommand } from "../approval/commands.js";
import { handleBackgroundCommand } from "../background/commands.js";
import { handleWorkflowCommand } from "../workflow/commands.js";
import { handleIdentityCommand } from "../identity/commands.js";
import { handleNotifyCommand } from "../notifications/commands.js";
import { handleWorktreeCommand } from "../worktree/commands.js";
import { handleSpawnCommand } from "../spawn/commands.js";
import { handleMonitorCommand } from "../monitor/commands.js";
import { handleReviewCommand } from "../review/commands.js";
import { getGreeting } from "../identity/identity.js";
import type { BackgroundRunner } from "../background/runner.js";
import type { AgentEvent, CursorAgentConfig } from "../types.js";
import type { Channel } from "./channel.js";

const MAX_MESSAGE_LENGTH = 3000;

export interface SlackChannelConfig {
  botToken: string;
  appToken?: string;        // for socket mode
  signingSecret?: string;   // for HTTP mode
  allowedChannels?: Set<string>;
  workspace: string;
  cursorConfig: CursorAgentConfig;
  backgroundRunner?: BackgroundRunner;
}

export class SlackChannel implements Channel {
  readonly name = "slack";

  private app: any;
  private agents = new Map<string, Agent>();
  private config: SlackChannelConfig;

  constructor(config: SlackChannelConfig) {
    this.config = config;
  }

  async sendTo(channelId: string, text: string, threadTs?: string): Promise<void> {
    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: chunk,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
    }
  }

  async start(): Promise<void> {
    // Dynamic import to make @slack/bolt optional
    const { App } = await import("@slack/bolt");

    const appConfig: any = {
      token: this.config.botToken,
    };

    if (this.config.appToken) {
      appConfig.socketMode = true;
      appConfig.appToken = this.config.appToken;
    } else if (this.config.signingSecret) {
      appConfig.signingSecret = this.config.signingSecret;
    }

    this.app = new App(appConfig);

    registerDeliveryHandler("slack", async (channelId, text) => {
      await this.sendTo(channelId, text);
    });

    // Handle messages (DMs and channels)
    this.app.message(async ({ message, say }: any) => {
      if (message.subtype || message.bot_id) return; // ignore bot messages / edits
      if (!this.isAllowed(message.channel)) return;
      await this.handleMessage(message.channel, message.text || "", message.ts, say);
    });

    // Handle @mentions
    this.app.event("app_mention", async ({ event, say }: any) => {
      if (!this.isAllowed(event.channel)) return;
      // Strip the mention prefix
      const text = (event.text || "").replace(/<@[A-Z0-9]+>\s*/g, "").trim();
      await this.handleMessage(event.channel, text, event.ts, say);
    });

    console.log("[slack] Starting...");
    await this.app.start();
    console.log("[slack] Bot is running");
  }

  async stop(): Promise<void> {
    console.log("[slack] Shutting down...");
    unregisterDeliveryHandler("slack");
    for (const agent of this.agents.values()) {
      if (agent.state.isStreaming) agent.abort();
    }
    await this.app?.stop();
  }

  private isAllowed(channelId: string): boolean {
    if (!this.config.allowedChannels || this.config.allowedChannels.size === 0) return true;
    return this.config.allowedChannels.has(channelId);
  }

  private getOrCreateAgent(channelId: string, workstation?: string): Agent {
    const key = workstation ? `${channelId}:${workstation}` : channelId;
    let agent = this.agents.get(key);
    if (!agent) {
      agent = new Agent(
        { ...this.config.cursorConfig, workstation },
        { useDb: true, sessionKey: `slack:${channelId}` },
      );
      this.agents.set(key, agent);
    }
    return agent;
  }

  private async handleMessage(
    channelId: string,
    text: string,
    threadTs: string,
    _say: any,
  ): Promise<void> {
    text = text.trim();
    if (!text) return;

    // Check for slash command handling
    if (text.startsWith("/")) {
      const cmdResult = await this.handleCommand(text, channelId);
      if (cmdResult) {
        await this.sendTo(channelId, cmdResult, threadTs);
        return;
      }
    }

    // Parse @workstation prefix
    let targetWorkstation: string | undefined;
    if (text.startsWith("@") && !text.startsWith("/")) {
      const spaceIdx = text.indexOf(" ");
      if (spaceIdx > 1) {
        targetWorkstation = text.slice(1, spaceIdx);
        text = text.slice(spaceIdx + 1).trim();
      }
    }

    // Mode prefix parsing
    const modeOverride = parseModePrefix(text);
    const promptOpts: { mode?: import("../mode.js").CursorMode } = {};
    if (modeOverride) {
      text = modeOverride.prompt;
      promptOpts.mode = modeOverride.mode;
    }

    const agent = this.getOrCreateAgent(channelId, targetWorkstation);

    if (agent.state.isStreaming) {
      agent.queueFollowUp(text);
      await this.sendTo(channelId, `Queued (${agent.queuedCount} pending).`, threadTs);
      return;
    }

    let responseText = "";
    let errorText = "";

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === "message_end" && event.text) {
        responseText += (responseText ? "\n\n" : "") + event.text;
      }
      if (event.type === "error") {
        errorText = event.message;
      }
    });

    try {
      await agent.prompt(text, promptOpts);
    } catch (err: unknown) {
      errorText = err instanceof Error ? err.message : String(err);
    } finally {
      unsubscribe();
    }

    if (errorText) {
      await this.sendTo(channelId, `Error: ${errorText}`, threadTs);
    } else if (responseText.trim()) {
      await this.sendTo(channelId, responseText, threadTs);
    } else {
      await this.sendTo(channelId, "(No response from agent)", threadTs);
    }
  }

  private async handleCommand(
    input: string,
    channelId: string,
  ): Promise<string | null> {
    const ctx = { channelType: "slack", channelId };

    // Try each command handler in order
    const syncHandlers: Array<() => { text: string } | null> = [
      () => handleSchedulerCommand(input, ctx),
      () => handleTriggerCommand(input, ctx),
      () => handleMemoryCommand(input),
      () => handleApprovalCommand(input, ctx),
      () => handleBackgroundCommand(input, this.config.backgroundRunner),
      () => handleIdentityCommand(input),
      () => handleSkillCommand(input, this.config.workspace),
      () => handleMcpCommand(input, this.config.workspace),
      () => handleHooksCommand(input, this.config.workspace),
      () => handleAgentCommand(input, this.config.workspace, this.config.backgroundRunner, this.config.cursorConfig) as { text: string } | null,
      () => handleCommandsCommand(input, this.config.workspace),
      () => handleWorkstationCommand(input),
      () => handleWorktreeCommand(input) as { text: string } | null,
      () => handleSpawnCommand(input) as { text: string } | null,
    ];

    for (const handler of syncHandlers) {
      const result = handler();
      if (result && "text" in result) return result.text;
    }

    // Notification commands (may return promise)
    const notifyResult = handleNotifyCommand(input);
    if (notifyResult !== null) {
      if (notifyResult instanceof Promise || (notifyResult && "then" in notifyResult)) {
        const resolved = await notifyResult;
        return resolved.text;
      }
      return (notifyResult as { text: string }).text;
    }

    // Async handlers
    const asyncHandlers: Array<() => Promise<{ text: string }> | { text: string } | null> = [
      () => handleCloudCommand(input, ctx),
      () => handleFleetCommand(input, ctx, this.config.cursorConfig),
      () => handleWorkflowCommand(input, ctx, this.config.cursorConfig),
      () => handleMonitorCommand(input, ctx, this.config.cursorConfig),
      () => handleReviewCommand(input, ctx, this.config.cursorConfig),
    ];

    for (const handler of asyncHandlers) {
      const result = handler();
      if (result !== null) {
        if (result instanceof Promise || (result && "then" in result)) {
          const resolved = await result;
          return resolved.text;
        }
        return (result as { text: string }).text;
      }
    }

    // Greeting
    if (input === "/start") {
      const greeting = getGreeting("slack");
      return greeting ?? "CureClaw is ready. Send me a prompt and I'll run it through Cursor agent.";
    }

    if (input === "/new") {
      const agent = this.agents.get(channelId);
      if (agent) agent.newSession();
      return "Session cleared. Next message starts fresh.";
    }

    if (input === "/status") {
      const agent = this.agents.get(channelId);
      const state = agent?.state;
      const sessionId = state?.sessionId?.slice(0, 8) ?? "none";
      const model = state?.model ?? "auto";
      const streaming = state?.isStreaming ? "yes" : "no";
      return `Session: ${sessionId}\nModel: ${model}\nProcessing: ${streaming}`;
    }

    return null;
  }
}

// --- Helpers ---

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen * 0.5) {
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
