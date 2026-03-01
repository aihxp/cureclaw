/**
 * CureClaw MCP Server — stdin/stdout JSON-RPC 2.0.
 * Exposes CureClaw system state as MCP tools.
 * Run with: cureclaw --mcp-server
 */

import * as readline from "node:readline";
import { initDatabase } from "../db.js";
import { toolDefinitions, handleToolCall } from "./tools.js";
import type { JsonRpcRequest, JsonRpcResponse } from "./protocol.js";

const SERVER_INFO = {
  name: "cureclaw",
  version: "1.1.0",
};

const CAPABILITIES = {
  tools: {},
};

function createResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function createError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function handleRequest(request: JsonRpcRequest): JsonRpcResponse {
  switch (request.method) {
    case "initialize":
      return createResponse(request.id, {
        protocolVersion: "2024-11-05",
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES,
      });

    case "tools/list":
      return createResponse(request.id, {
        tools: toolDefinitions,
      });

    case "tools/call": {
      const params = request.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        return createError(request.id, -32602, "Missing tool name");
      }
      const result = handleToolCall(params.name, params.arguments ?? {});
      return createResponse(request.id, result);
    }

    case "notifications/initialized":
      // Client acknowledgment, no response needed for notifications
      // But if it was sent as a request with an id, respond
      return createResponse(request.id, {});

    default:
      return createError(request.id, -32601, `Method not found: ${request.method}`);
  }
}

export async function startMcpServer(): Promise<void> {
  initDatabase();

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const request = JSON.parse(trimmed) as JsonRpcRequest;

      // Skip notifications (no id)
      if (!("id" in request)) return;

      const response = handleRequest(request);
      process.stdout.write(JSON.stringify(response) + "\n");
    } catch {
      const errorResponse = createError(null, -32700, "Parse error");
      process.stdout.write(JSON.stringify(errorResponse) + "\n");
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

// If run directly
if (process.argv[1]?.endsWith("mcp-server/index.js") || process.argv[1]?.endsWith("mcp-server/index.ts")) {
  startMcpServer().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}
