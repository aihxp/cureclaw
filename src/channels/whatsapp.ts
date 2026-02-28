import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  type WASocket,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { Agent } from "../agent.js";
import type { AgentEvent, CursorAgentConfig } from "../types.js";
import type { Channel } from "./channel.js";

const MAX_MESSAGE_LENGTH = 4096;
const TYPING_INTERVAL_MS = 10_000;
const RECONNECT_DELAY_MS = 5_000;

export interface WhatsAppChannelConfig {
  authDir: string;
  workspace: string;
  cursorConfig: CursorAgentConfig;
  allowedJids?: Set<string>;
  triggerWord?: string;
  botName?: string;
}

interface QueuedMessage {
  jid: string;
  text: string;
}

export class WhatsAppChannel implements Channel {
  readonly name = "whatsapp";

  private sock!: WASocket;
  private agents = new Map<string, Agent>();
  private config: WhatsAppChannelConfig;
  private connected = false;
  private outgoingQueue: QueuedMessage[] = [];
  private flushing = false;

  constructor(config: WhatsAppChannelConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectInternal(resolve).catch(reject);
    });
  }

  async stop(): Promise<void> {
    console.log("[whatsapp] Shutting down...");
    for (const agent of this.agents.values()) {
      if (agent.state.isStreaming) agent.abort();
    }
    this.sock?.end(undefined);
  }

  private async connectInternal(
    onFirstConnect?: (value: void) => void,
  ): Promise<void> {
    const logger = pino({ level: "silent" });
    const { state, saveCreds } = await useMultiFileAuthState(
      this.config.authDir,
    );

    const { version } = await fetchLatestWaWebVersion();

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      version,
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS("Chrome"),
    });

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("[whatsapp] Scan this QR code with WhatsApp:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        this.connected = true;
        console.log("[whatsapp] Connected to WhatsApp");
        this.sock.sendPresenceUpdate("available").catch(() => {});
        this.flushOutgoingQueue();
        onFirstConnect?.();
        onFirstConnect = undefined;
      }

      if (connection === "close") {
        this.connected = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log(
            "[whatsapp] Logged out. Delete auth dir and restart to re-authenticate.",
          );
          process.exit(0);
        }

        console.log(
          `[whatsapp] Disconnected (code ${statusCode}), reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`,
        );
        setTimeout(() => {
          this.connectInternal().catch((err) => {
            console.error("[whatsapp] Reconnection failed:", err.message);
          });
        }, RECONNECT_DELAY_MS);
      }
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;

        const jid = msg.key.remoteJid;
        if (!jid || jid === "status@broadcast") continue;
        if (msg.key.fromMe) continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          "";

        if (!text.trim()) continue;

        // Access control
        if (
          this.config.allowedJids &&
          this.config.allowedJids.size > 0 &&
          !this.config.allowedJids.has(jid)
        ) {
          continue;
        }

        // Group trigger check
        const isGroup = jid.endsWith("@g.us");
        let prompt = text.trim();

        if (isGroup && this.config.triggerWord) {
          const lower = prompt.toLowerCase();
          const trigger = this.config.triggerWord.toLowerCase();
          if (!lower.includes(trigger)) continue;
          prompt = prompt.replace(new RegExp(this.config.triggerWord, "gi"), "").trim();
          if (!prompt) continue;
        }

        this.handleMessage(jid, prompt);
      }
    });
  }

  private async handleMessage(jid: string, text: string): Promise<void> {
    const agent = this.getOrCreateAgent(jid);

    if (agent.state.isStreaming) {
      await this.sendMessage(
        jid,
        "Still processing your previous request. Please wait.",
      );
      return;
    }

    // Typing indicator
    this.setTyping(jid, true);
    const typingInterval = setInterval(() => {
      this.setTyping(jid, true);
    }, TYPING_INTERVAL_MS);

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
      this.setTyping(jid, false);
      unsubscribe();
    }

    if (errorText) {
      await this.sendMessage(jid, `Error: ${errorText}`);
    } else if (responseText.trim()) {
      await this.sendMessage(jid, responseText);
    } else {
      await this.sendMessage(jid, "(No response from agent)");
    }
  }

  private getOrCreateAgent(jid: string): Agent {
    let agent = this.agents.get(jid);
    if (!agent) {
      agent = new Agent(
        { ...this.config.cursorConfig },
        { useDb: true, sessionKey: `wa:${jid}` },
      );
      this.agents.set(jid, agent);
    }
    return agent;
  }

  private async sendMessage(jid: string, text: string): Promise<void> {
    const prefixed = this.config.botName
      ? `${this.config.botName}: ${text}`
      : text;

    const chunks = splitMessage(prefixed, MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      if (!this.connected) {
        this.outgoingQueue.push({ jid, text: chunk });
        console.log(
          `[whatsapp] Disconnected, message queued (queue size: ${this.outgoingQueue.length})`,
        );
        continue;
      }

      try {
        await this.sock.sendMessage(jid, { text: chunk });
      } catch (err) {
        this.outgoingQueue.push({ jid, text: chunk });
        console.warn(
          `[whatsapp] Failed to send, message queued (queue size: ${this.outgoingQueue.length})`,
        );
      }
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      console.log(
        `[whatsapp] Flushing ${this.outgoingQueue.length} queued messages`,
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        await this.sock.sendMessage(item.jid, { text: item.text });
      }
    } catch (err) {
      console.error("[whatsapp] Queue flush error:", err);
    } finally {
      this.flushing = false;
    }
  }

  private setTyping(jid: string, isTyping: boolean): void {
    const status = isTyping ? "composing" : "paused";
    this.sock.sendPresenceUpdate(status, jid).catch(() => {});
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
