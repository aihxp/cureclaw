import { Bot, type Context } from "grammy";
import { Agent } from "../agent.js";
import { handleAgentCommand } from "../agents/commands.js";
import { handleCloudCommand } from "../cloud/commands.js";
import { handleFleetCommand } from "../fleet/commands.js";
import { handleCommandsCommand } from "../commands/commands.js";
import { handleHooksCommand } from "../hooks/commands.js";
import type { ImageAttachment } from "../images.js";
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

const MAX_MESSAGE_LENGTH = 4096;

export interface TelegramChannelConfig {
  token: string;
  allowedUsers?: Set<number>;
  workspace: string;
  cursorConfig: CursorAgentConfig;
  backgroundRunner?: BackgroundRunner;
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
      const greeting = getGreeting("telegram");
      await ctx.reply(
        greeting ?? "CureClaw is ready. Send me a prompt and I'll run it through Cursor agent.\n\n" +
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

    this.bot.command("mode", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const modeArg = ctx.match?.toString().trim() ?? "";
      const agent = this.getOrCreateAgent(chatId);
      if (!modeArg) {
        await ctx.reply(`Current mode: ${agent.state.mode}\nUsage: /mode <agent|plan|ask>`);
      } else {
        const { isValidMode } = await import("../mode.js");
        if (isValidMode(modeArg)) {
          agent.setMode(modeArg);
          await ctx.reply(`Mode set to: ${modeArg}`);
        } else {
          await ctx.reply(`Invalid mode: "${modeArg}". Valid modes: agent, plan, ask`);
        }
      }
    });

    this.bot.command("hooks", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleHooksCommand(`/hooks ${args}`, this.config.workspace);
      await ctx.reply(result?.text ?? "Usage: /hooks list|add|remove");
    });

    this.bot.command("trigger", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleTriggerCommand(`/trigger ${args}`, {
        channelType: "telegram",
        channelId: String(chatId),
      });
      await ctx.reply(result?.text ?? "Usage: /trigger add|list|remove|enable|disable|info");
    });

    this.bot.command("fleet", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const fleetCtx = { channelType: "telegram", channelId: String(chatId) };
      const resultPromise = handleFleetCommand(`/fleet ${args}`, fleetCtx, this.config.cursorConfig);
      if (resultPromise) {
        const result = await resultPromise;
        await ctx.reply(result.text);
      }
    });

    this.bot.command("orchestrate", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const orchCtx = { channelType: "telegram", channelId: String(chatId) };
      const resultPromise = handleFleetCommand(`/orchestrate ${args}`, orchCtx, this.config.cursorConfig);
      if (resultPromise) {
        const result = await resultPromise;
        await ctx.reply(result.text);
      }
    });

    this.bot.command("runs", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const runsCtx = { channelType: "telegram", channelId: String(chatId) };
      const result = handleFleetCommand(`/runs ${args}`, runsCtx);
      if (result) {
        await ctx.reply((result as { text: string }).text);
      }
    });

    this.bot.command("agents", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const resultOrPromise = handleAgentCommand("/agents", this.config.workspace);
      const result = resultOrPromise instanceof Promise ? await resultOrPromise : resultOrPromise;
      await ctx.reply((result as { text: string } | null)?.text ?? "No subagents found.");
    });

    this.bot.command("commands", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const result = handleCommandsCommand("/commands", this.config.workspace);
      await ctx.reply(result?.text ?? "No commands found.");
    });

    this.bot.command("run", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleCommandsCommand(`/run ${args}`, this.config.workspace);
      if (result?.runPrompt) {
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
          await agent.prompt(result.runPrompt);
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
          await this.sendResponse(chatId, "(No response from command)");
        }
        return;
      }
      await ctx.reply(result?.text ?? "Usage: /run <command-name>");
    });

    this.bot.command("remember", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleMemoryCommand(`/remember ${args}`);
      await ctx.reply(result?.text ?? "Usage: /remember <key> <content>");
    });

    this.bot.command("recall", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleMemoryCommand(`/recall ${args}`);
      await ctx.reply(result?.text ?? "No memories found.");
    });

    this.bot.command("forget", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleMemoryCommand(`/forget ${args}`);
      await ctx.reply(result?.text ?? "Usage: /forget <key>");
    });

    this.bot.command("background", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleBackgroundCommand(`/background ${args}`, this.config.backgroundRunner);
      await ctx.reply(result?.text ?? "Usage: /background help");
    });

    this.bot.command("approval", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleApprovalCommand(`/approval ${args}`, {
        channelType: "telegram",
        channelId: String(chatId),
      });
      await ctx.reply(result?.text ?? "Usage: /approval help");
    });

    this.bot.command("workflow", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      const args = ctx.match?.toString().trim() ?? "";
      const wfCtx = { channelType: "telegram", channelId: String(chatId) };
      const resultPromise = handleWorkflowCommand(`/workflow ${args}`, wfCtx, this.config.cursorConfig);
      if (resultPromise) {
        const result = await resultPromise;
        await ctx.reply(result.text);
      }
    });

    this.bot.command("identity", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const result = handleIdentityCommand(`/identity ${args}`);
      await ctx.reply(result?.text ?? "Usage: /identity help");
    });

    this.bot.command("notify", async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return;
      const args = ctx.match?.toString().trim() ?? "";
      const resultOrPromise = handleNotifyCommand(`/notify ${args}`);
      if (resultOrPromise) {
        const result = resultOrPromise instanceof Promise ? await resultOrPromise : resultOrPromise;
        await ctx.reply((result as { text: string }).text);
      } else {
        await ctx.reply("Usage: /notify help");
      }
    });

    // Handle photo messages for image passthrough
    this.bot.on("message:photo", async (ctx) => {
      await this.handlePhotoMessage(ctx);
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

    // Mode prefix parsing
    const modeOverride = parseModePrefix(text);
    const promptOpts: { mode?: import("../mode.js").CursorMode } = {};
    if (modeOverride) {
      text = modeOverride.prompt;
      promptOpts.mode = modeOverride.mode;
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
      await agent.prompt(text, promptOpts);
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

  private async handlePhotoMessage(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx.from?.id)) {
      await ctx.reply("Access denied.");
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const caption = ctx.message?.caption?.trim() ?? "Describe this image.";

    // Get the largest photo size
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) return;
    const largestPhoto = photos[photos.length - 1];

    const agent = this.getOrCreateAgent(chatId);
    if (agent.state.isStreaming) {
      agent.queueFollowUp(caption);
      await ctx.reply(`Queued (${agent.queuedCount} pending).`);
      return;
    }

    // Download photo
    let images: ImageAttachment[] = [];
    try {
      const file = await ctx.api.getFile(largestPhoto.file_id);
      const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());
      images = [{
        data: buffer.toString("base64"),
        mediaType: "image/jpeg",
        dimensions: { width: largestPhoto.width, height: largestPhoto.height },
      }];
    } catch {
      // If download fails, proceed text-only
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
      await agent.prompt(caption, { images: images.length > 0 ? images : undefined });
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
