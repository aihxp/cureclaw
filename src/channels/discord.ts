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
import { getGreeting } from "../identity/identity.js";
import type { BackgroundRunner } from "../background/runner.js";
import type { AgentEvent, CursorAgentConfig } from "../types.js";
import type { Channel } from "./channel.js";

const MAX_MESSAGE_LENGTH = 2000;

export interface DiscordChannelConfig {
  botToken: string;
  allowedChannels?: Set<string>;
  allowedGuilds?: Set<string>;
  workspace: string;
  cursorConfig: CursorAgentConfig;
  backgroundRunner?: BackgroundRunner;
}

export class DiscordChannel implements Channel {
  readonly name = "discord";

  private client: any;
  private agents = new Map<string, Agent>();
  private config: DiscordChannelConfig;

  constructor(config: DiscordChannelConfig) {
    this.config = config;
  }

  async sendTo(channelId: string, text: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  async start(): Promise<void> {
    // Dynamic import to make discord.js optional
    const { Client, GatewayIntentBits, Events } = await import("discord.js");

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    registerDeliveryHandler("discord", async (channelId, text) => {
      await this.sendTo(channelId, text);
    });

    this.client.on(Events.ClientReady, () => {
      console.log(`[discord] Bot ${this.client.user?.tag} is running`);
    });

    this.client.on(Events.MessageCreate, async (message: any) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Access control
      if (!this.isAllowed(message.channelId, message.guildId)) return;

      const text = message.content?.trim();
      if (!text) return;

      await this.handleMessage(message);
    });

    console.log("[discord] Starting...");
    await this.client.login(this.config.botToken);
  }

  async stop(): Promise<void> {
    console.log("[discord] Shutting down...");
    unregisterDeliveryHandler("discord");
    for (const agent of this.agents.values()) {
      if (agent.state.isStreaming) agent.abort();
    }
    await this.client?.destroy();
  }

  private isAllowed(channelId: string, guildId: string | null): boolean {
    if (this.config.allowedGuilds && this.config.allowedGuilds.size > 0) {
      if (!guildId || !this.config.allowedGuilds.has(guildId)) return false;
    }
    if (this.config.allowedChannels && this.config.allowedChannels.size > 0) {
      return this.config.allowedChannels.has(channelId);
    }
    return true;
  }

  private getOrCreateAgent(channelId: string, workstation?: string): Agent {
    const key = workstation ? `${channelId}:${workstation}` : channelId;
    let agent = this.agents.get(key);
    if (!agent) {
      agent = new Agent(
        { ...this.config.cursorConfig, workstation },
        { useDb: true, sessionKey: `discord:${channelId}` },
      );
      this.agents.set(key, agent);
    }
    return agent;
  }

  private async handleMessage(message: any): Promise<void> {
    let text = message.content?.trim();
    if (!text) return;
    const channelId = message.channelId;

    // Check for slash command handling
    if (text.startsWith("/")) {
      const cmdResult = await this.runCommand(text, channelId);
      if (cmdResult) {
        await this.reply(message, cmdResult);
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
      await this.reply(message, `Queued (${agent.queuedCount} pending).`);
      return;
    }

    // Typing indicator — refresh every 8s (Discord typing lasts ~10s)
    let typing = true;
    const sendTyping = async () => {
      while (typing) {
        try { await message.channel.sendTyping(); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 8000));
      }
    };
    const typingPromise = sendTyping();

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
      typing = false;
      await typingPromise.catch(() => {});
      unsubscribe();
    }

    if (errorText) {
      await this.reply(message, `Error: ${errorText}`);
    } else if (responseText.trim()) {
      await this.reply(message, responseText);
    } else {
      await this.reply(message, "(No response from agent)");
    }
  }

  private async reply(message: any, text: string): Promise<void> {
    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);

    // If response is long, create a thread
    if (chunks.length > 1 && message.channel.isTextBased() && message.channel.threads) {
      try {
        const thread = await message.startThread({
          name: `Response to: ${message.content?.slice(0, 50) || "prompt"}`,
          autoArchiveDuration: 60,
        });
        for (const chunk of chunks) {
          await thread.send(chunk);
        }
        return;
      } catch {
        // Fall through to regular reply
      }
    }

    for (const chunk of chunks) {
      try {
        await message.reply(chunk);
      } catch {
        // If reply fails, try channel send
        try { await message.channel.send(chunk); } catch { /* ignore */ }
      }
    }
  }

  private async runCommand(
    input: string,
    channelId: string,
  ): Promise<string | null> {
    const ctx = { channelType: "discord", channelId };

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

    // Built-in commands
    if (input === "/start") {
      const greeting = getGreeting("discord");
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
