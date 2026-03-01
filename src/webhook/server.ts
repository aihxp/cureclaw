import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import type { CloudAgentStatus } from "../cloud/types.js";

export interface WebhookEvent {
  event: "statusChange";
  agentId: string;
  status: CloudAgentStatus;
  summary?: string;
  timestamp: string;
}

export type WebhookHandler = (event: WebhookEvent) => void;

export interface TriggerWebhookEvent {
  name: string;
  payload: Record<string, unknown>;
}

export type TriggerWebhookHandler = (event: TriggerWebhookEvent) => void;

const TRIGGER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export class WebhookServer {
  private server: ReturnType<typeof createServer>;
  private secret: string;
  private handlers = new Set<WebhookHandler>();
  private triggerHandlers = new Set<TriggerWebhookHandler>();
  private triggerSecret: string | undefined;
  private port: number;
  private assignedPort = 0;

  constructor(opts?: { port?: number; secret?: string; triggerSecret?: string }) {
    this.port = opts?.port ?? 0;
    this.secret = opts?.secret ?? crypto.randomUUID();
    this.triggerSecret = opts?.triggerSecret;
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  get webhookUrl(): string {
    const host = os.hostname();
    return `http://${host}:${this.assignedPort}/webhook`;
  }

  get webhookSecret(): string {
    return this.secret;
  }

  subscribe(handler: WebhookHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  subscribeTrigger(handler: TriggerWebhookHandler): () => void {
    this.triggerHandlers.add(handler);
    return () => {
      this.triggerHandlers.delete(handler);
    };
  }

  async start(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, () => {
        const addr = this.server.address();
        if (addr && typeof addr === "object") {
          this.assignedPort = addr.port;
        }
        resolve(this.assignedPort);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // POST /webhook — HMAC-verified cloud status handler
    if (req.url === "/webhook") {
      this.handleCloudWebhook(req, res);
      return;
    }

    // POST /trigger/:name — trigger endpoint
    const triggerMatch = req.url?.match(/^\/trigger\/([a-z0-9][a-z0-9-]{0,63})$/);
    if (triggerMatch) {
      this.handleTriggerWebhook(req, res, triggerMatch[1]);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  }

  private handleCloudWebhook(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      const signature = req.headers["x-webhook-signature"] as string | undefined;
      if (!signature || !verifySignature(body, signature, this.secret)) {
        res.writeHead(401);
        res.end("Invalid signature");
        return;
      }

      let event: WebhookEvent;
      try {
        event = JSON.parse(body) as WebhookEvent;
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
        return;
      }

      for (const handler of this.handlers) {
        try {
          handler(event);
        } catch {
          // Handler errors should not crash the server
        }
      }

      res.writeHead(200);
      res.end("OK");
    });
  }

  private handleTriggerWebhook(req: IncomingMessage, res: ServerResponse, name: string): void {
    if (!TRIGGER_NAME_RE.test(name)) {
      res.writeHead(400);
      res.end("Invalid trigger name");
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      // Optional secret check
      if (this.triggerSecret) {
        const provided = req.headers["x-trigger-secret"] as string | undefined;
        if (provided !== this.triggerSecret) {
          res.writeHead(401);
          res.end("Invalid trigger secret");
          return;
        }
      }

      let payload: Record<string, unknown> = {};
      if (body) {
        try {
          payload = JSON.parse(body) as Record<string, unknown>;
        } catch {
          res.writeHead(400);
          res.end("Invalid JSON");
          return;
        }
      }

      const event: TriggerWebhookEvent = { name, payload };

      for (const handler of this.triggerHandlers) {
        try {
          handler(event);
        } catch {
          // Handler errors should not crash the server
        }
      }

      res.writeHead(200);
      res.end("OK");
    });
  }
}
