import { Bot, type Context } from "grammy";
import { Agent } from "../agent.js";
import { handleCloudCommand } from "../cloud/commands.js";
import { handleMcpCommand } from "../mcp/commands.js";
import { handleSchedulerCommand, handlePipelineCommand } from "../scheduler/commands.js";
import { registerDeliveryHandler, unregisterDeliveryHandler } from "../scheduler/delivery.js";
import { handleSkillCommand } from "../skills/commands.js";
import { handleWorkstationCommand } from "../workstation-commands.js";
import type { AgentEvent, CursorAgentConfig } from "../types.js";
import type { Channel } from "./channel.js";

const MAX_MESSAGE_LENGTH = 4096;

export interface TelegramChannelConfig {
  token: string;
  allowedUsers?: Set<number>;
  workspace: string;
  cursorConfig: CursorAgentConfig;
}

export class TelegramChannel implements Channel {
  readonly name = "telegram";

  private bot: Bot;
  private agents = new Map<string, Agent>();
  private config: TelegramChannelConfig;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
    this.bot = new Bot(config.token);
  }

  async sendTo(chatId: number, text: string): Promise<void> {
    await this.sendResponse(chatId, text);
  }

  async start(): Promise<void> {
    registerDeliveryHandler("telegram", async (channelId, text) => {
      await this.sendTo(Number(channelId), text);
    });

    this.bot.command("start", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) {
        await ctx.reply("Access denied.");
        return;
      }
      await ctx.reply(
        "CureClaw is ready. Send me a prompt and I'll run it through Cursor agent.\n\n" +
          "Commands:\n/new — Start a fresh session\n/status — Show current session info",
      );
    });

    this.bot.command("new", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const agent = this.agents.get(String(ctx.chat.id));
      if (agent) agent.newSession();
      await ctx.reply("Session cleared. Next message starts fresh.");
    });

    this.bot.command("status", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const agent = this.agents.get(String(ctx.chat.id));
      const state = agent?.state;
      const sessionId = state?.sessionId?.slice(0, 8) ?? "none";
      const model = state?.model ?? "auto";
      const streaming = state?.isStreaming ? "yes" : "no";
      await ctx.reply(
        `Session: ${sessionId}\nModel: ${model}\nProcessing: ${streaming}`,
      );
    });

    this.bot.command("schedule", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim();
      const result = handleSchedulerCommand(`/schedule ${args}`, {
        channelType: "telegram",
        channelId: String(chatId),
      });
      await ctx.reply(result?.text ?? "Usage: /schedule \"prompt\" <schedule>");
    });

    this.bot.command("jobs", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const result = handleSchedulerCommand("/jobs", {
        channelType: "telegram",
        channelId: String(ctx.chat?.id ?? 0),
      });
      await ctx.reply(result?.text ?? "No jobs.");
    });

    this.bot.command("cancel", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const idPrefix = ctx.match?.toString().trim();
      const result = handleSchedulerCommand(`/cancel ${idPrefix}`, {
        channelType: "telegram",
        channelId: String(ctx.chat?.id ?? 0),
      });
      await ctx.reply(result?.text ?? "Usage: /cancel <id-prefix>");
    });

    this.bot.command("cloud", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const cloudCtx = { channelType: "telegram", channelId: String(chatId) };
      const resultPromise = handleCloudCommand(`/cloud ${args}`, cloudCtx);
      if (resultPromise) {
        const result = await resultPromise;
        await ctx.reply(result.text);
      }
    });

    this.bot.command("skill", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleSkillCommand(`/skill ${args}`, this.config.workspace);
      await ctx.reply(result?.text ?? "Usage: /skill create <name>");
    });

    this.bot.command("skills", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const result = handleSkillCommand("/skills", this.config.workspace);
      await ctx.reply(result?.text ?? "No skills found.");
    });

    this.bot.command("mcp", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleMcpCommand(`/mcp ${args}`, this.config.workspace);
      await ctx.reply(result?.text ?? "Usage: /mcp list|add|remove");
    });

    this.bot.command("pipeline", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const pipeCtx = { channelType: "telegram", channelId: String(chatId) };
      const result = handlePipelineCommand(`/pipeline ${args}`, pipeCtx);
      if (result?.pipeline) {
        const agent = this.getOrCreateAgent(chatId);
        if (agent.state.isStreaming) {
          await ctx.reply("Still processing. Please wait.");
          return;
        }

        this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
        const typingInterval = setInterval(() => {
          this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
        }, 4000);

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
          await agent.runPipeline(result.pipeline);
        } catch (err: unknown) {
          errorText = err instanceof Error ? err.message : String(err);
        } finally {
          clearInterval(typingInterval);
          unsubscribe();
        }

        if (errorText) {
          await this.sendResponse(chatId, `Error: ${errorText}`);
        } else if (responseText.trim()) {
          await this.sendResponse(chatId, responseText);
        } else {
          await this.sendResponse(chatId, "(No response from pipeline)");
        }
        return;
      }
      await ctx.reply(result?.text ?? 'Usage: /pipeline "step1" "step2"');
    });

    this.bot.command("workstation", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleWorkstationCommand(`/workstation ${args}`);
      await ctx.reply(result?.text ?? "Usage: /workstation list|add|remove|default|status");
    });

    this.bot.on("message:text", async (ctx) => {
      await this.handleMessage(ctx);
    });

    this.bot.catch((err) => {
      console.error("[telegram] Bot error:", err.message);
    });

    console.log("[telegram] Bot starting...");
    await this.bot.start({
      onStart: (botInfo) => {
        console.log(`[telegram] Bot @${botInfo.username} is running`);
      },
    });
  }

  async stop(): Promise<void> {
    console.log("[telegram] Shutting down...");
    unregisterDeliveryHandler("telegram");
    for (const agent of this.agents.values()) {
      if (agent.state.isStreaming) agent.abort();
    }
    this.bot.stop();
  }

  private isAllowed(userId: number | undefined): boolean {
    if (!userId) return false;
    if (!this.config.allowedUsers || this.config.allowedUsers.size === 0)
      return true;
    return this.config.allowedUsers.has(userId);
  }

  private getOrCreateAgent(chatId: number, workstation?: string): Agent {
    const key = workstation ? `${chatId}:${workstation}` : String(chatId);
    let agent = this.agents.get(key);
    if (!agent) {
      agent = new Agent(
        { ...this.config.cursorConfig, workstation },
        { useDb: true, sessionKey: `tg:${chatId}` },
      );
      this.agents.set(key, agent);
    }
    return agent;
  }

  private async handleMessage(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx.from?.id)) {
      await ctx.reply("Access denied.");
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;
    let text = ctx.message?.text?.trim();
    if (!text) return;

    // Parse @workstation prefix
    let targetWorkstation: string | undefined;
    if (text.startsWith("@") && !text.startsWith("/")) {
      const spaceIdx = text.indexOf(" ");
      if (spaceIdx > 1) {
        targetWorkstation = text.slice(1, spaceIdx);
        text = text.slice(spaceIdx + 1).trim();
      }
    }

    const agent = this.getOrCreateAgent(chatId, targetWorkstation);

    if (agent.state.isStreaming) {
      agent.queueFollowUp(text);
      await ctx.reply(`Queued (${agent.queuedCount} pending).`);
      return;
    }

    // Typing indicator — send every 4s (expires after ~5s in Telegram)
    this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
    const typingInterval = setInterval(() => {
      this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);

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
      await agent.prompt(text);
    } catch (err: unknown) {
      errorText = err instanceof Error ? err.message : String(err);
    } finally {
      clearInterval(typingInterval);
      unsubscribe();
    }

    if (errorText) {
      await this.sendResponse(chatId, `Error: ${errorText}`);
    } else if (responseText.trim()) {
      await this.sendResponse(chatId, responseText);
    } else {
      await this.sendResponse(chatId, "(No response from agent)");
    }
  }

  private async sendResponse(chatId: number, text: string): Promise<void> {
    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      try {
        await this.bot.api.sendMessage(chatId, markdownToHtml(chunk), {
          parse_mode: "HTML",
        });
      } catch {
        // Fall back to plain text if HTML parsing fails
        await this.bot.api.sendMessage(chatId, chunk);
      }
    }
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
    // Try to split at a newline near the limit
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

/**
 * Best-effort Markdown → Telegram HTML conversion.
 * Handles code blocks, inline code, bold, and italic.
 */
function markdownToHtml(text: string): string {
  let result = text;

  // Escape HTML entities
  result = result.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks: ```lang\n...\n``` → <pre><code>...</code></pre>
  result = result.replace(/```(?:\w*)\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

  // Inline code: `...` → <code>...</code>
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold: **...** → <b>...</b>
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *...* → <i>...</i>
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  return result;
}
