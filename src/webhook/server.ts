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

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export class WebhookServer {
  private server: ReturnType<typeof createServer>;
  private secret: string;
  private handlers = new Set<WebhookHandler>();
  private port: number;
  private assignedPort = 0;

  constructor(opts?: { port?: number; secret?: string }) {
    this.port = opts?.port ?? 0;
    this.secret = opts?.secret ?? crypto.randomUUID();
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
    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

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
}
