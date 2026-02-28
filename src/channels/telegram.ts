import { Bot, type Context } from "grammy";
import { Agent } from "../agent.js";
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
  private agents = new Map<number, Agent>();
  private config: TelegramChannelConfig;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
    this.bot = new Bot(config.token);
  }

  async start(): Promise<void> {
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
      const agent = this.agents.get(ctx.chat.id);
      if (agent) agent.newSession();
      await ctx.reply("Session cleared. Next message starts fresh.");
    });

    this.bot.command("status", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const agent = this.agents.get(ctx.chat.id);
      const state = agent?.state;
      const sessionId = state?.sessionId?.slice(0, 8) ?? "none";
      const model = state?.model ?? "auto";
      const streaming = state?.isStreaming ? "yes" : "no";
      await ctx.reply(
        `Session: ${sessionId}\nModel: ${model}\nProcessing: ${streaming}`,
      );
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

  private getOrCreateAgent(chatId: number): Agent {
    let agent = this.agents.get(chatId);
    if (!agent) {
      agent = new Agent(
        { ...this.config.cursorConfig },
        { useDb: true, sessionKey: `tg:${chatId}` },
      );
      this.agents.set(chatId, agent);
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
    const text = ctx.message?.text?.trim();
    if (!text) return;

    const agent = this.getOrCreateAgent(chatId);

    if (agent.state.isStreaming) {
      await ctx.reply("Still processing your previous request. Please wait.");
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
