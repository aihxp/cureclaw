import { EventStream } from "./event-stream.js";
import { spawnCursor, parseCursorEvent } from "./cursor-client.js";
import type {
  AgentEvent,
  CursorAgentConfig,
  CursorStreamEvent,
  CursorToolCallPayload,
} from "./types.js";

/**
 * Run a single agent loop: spawn Cursor CLI, translate its stream-json
 * output into Pi-style AgentEvents, and return an async iterable EventStream.
 */
export function agentLoop(
  prompt: string,
  config: CursorAgentConfig,
  signal?: AbortSignal,
): EventStream<AgentEvent, AgentEvent> {
  const stream = new EventStream<AgentEvent, AgentEvent>(
    (e) => e.type === "agent_end" || e.type === "error",
    (e) => e,
  );

  // Run async pipeline without blocking
  runPipeline(prompt, config, stream, signal).catch((err) => {
    if (!stream.isDone) {
      const event: AgentEvent = {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
      stream.push(event);
      stream.end(event);
    }
  });

  return stream;
}

async function runPipeline(
  prompt: string,
  config: CursorAgentConfig,
  stream: EventStream<AgentEvent, AgentEvent>,
  signal?: AbortSignal,
): Promise<void> {
  const cursor = spawnCursor(prompt, config, signal);

  let turnStarted = false;
  let messageStarted = false;
  let lastSessionId = "";

  for await (const line of cursor.lines) {
    if (stream.isDone) break;

    const event = parseCursorEvent(line);
    if (!event) continue;

    translateEvent(event, stream, {
      get turnStarted() {
        return turnStarted;
      },
      set turnStarted(v: boolean) {
        turnStarted = v;
      },
      get messageStarted() {
        return messageStarted;
      },
      set messageStarted(v: boolean) {
        messageStarted = v;
      },
      get lastSessionId() {
        return lastSessionId;
      },
      set lastSessionId(v: string) {
        lastSessionId = v;
      },
    });
  }

  // If cursor exited without emitting a result event, handle it
  if (!stream.isDone) {
    const exitCode = cursor.proc.exitCode;
    if (exitCode !== 0 && exitCode !== null) {
      const stderr = cursor.stderr().slice(-500);
      const event: AgentEvent = {
        type: "error",
        message: `Cursor exited with code ${exitCode}${stderr ? `: ${stderr}` : ""}`,
      };
      stream.push(event);
      stream.end(event);
    } else {
      // Clean exit without result event — end gracefully
      if (turnStarted) {
        stream.push({ type: "turn_end" });
      }
      stream.end();
    }
  }
}

interface TranslationState {
  turnStarted: boolean;
  messageStarted: boolean;
  lastSessionId: string;
}

function translateEvent(
  event: CursorStreamEvent,
  stream: EventStream<AgentEvent, AgentEvent>,
  state: TranslationState,
): void {
  switch (event.type) {
    case "system":
      state.lastSessionId = event.session_id;
      stream.push({
        type: "agent_start",
        sessionId: event.session_id,
        model: event.model,
      });
      break;

    case "user":
      // Cursor echoes the user message — we don't need to emit this
      break;

    case "thinking":
      if (event.subtype === "delta") {
        stream.push({ type: "thinking_delta", text: event.text });
      } else {
        stream.push({ type: "thinking_end" });
      }
      break;

    case "assistant": {
      if (!state.turnStarted) {
        stream.push({ type: "turn_start" });
        state.turnStarted = true;
      }

      const text = event.message.content[0]?.text ?? "";

      if (event.timestamp_ms !== undefined) {
        // Partial delta (has timestamp_ms)
        if (!state.messageStarted) {
          stream.push({ type: "message_start" });
          state.messageStarted = true;
        }
        stream.push({ type: "message_delta", text });
      } else {
        // Final complete message (no timestamp_ms)
        if (!state.messageStarted) {
          stream.push({ type: "message_start" });
        }
        stream.push({ type: "message_end", text });
        state.messageStarted = false;
      }
      break;
    }

    case "tool_call": {
      if (!state.turnStarted) {
        stream.push({ type: "turn_start" });
        state.turnStarted = true;
      }

      if (event.subtype === "started") {
        stream.push({
          type: "tool_start",
          callId: event.call_id,
          toolName: extractToolName(event.tool_call),
          description: extractDescription(event.tool_call),
          args: extractArgs(event.tool_call),
        });
      } else {
        const { success, resultText } = extractToolResult(event.tool_call);
        stream.push({
          type: "tool_end",
          callId: event.call_id,
          toolName: extractToolName(event.tool_call),
          success,
          result: resultText,
        });
      }
      break;
    }

    case "result": {
      if (state.messageStarted) {
        // Close any open message that wasn't finalized
        stream.push({ type: "message_end", text: "" });
        state.messageStarted = false;
      }
      if (state.turnStarted) {
        stream.push({ type: "turn_end" });
        state.turnStarted = false;
      }

      if (event.is_error || event.subtype === "error") {
        const errEvent: AgentEvent = {
          type: "error",
          message: event.result || "Unknown error",
        };
        stream.push(errEvent);
        stream.end(errEvent);
      } else {
        const endEvent: AgentEvent = {
          type: "agent_end",
          sessionId: event.session_id,
          result: event.result,
          usage: event.usage,
          durationMs: event.duration_ms,
        };
        stream.push(endEvent);
        stream.end(endEvent);
      }
      break;
    }
  }
}

// --- Tool call payload helpers ---

function extractToolName(toolCall: CursorToolCallPayload): string {
  const keys = Object.keys(toolCall).filter((k) => k.endsWith("ToolCall"));
  if (keys.length > 0) {
    return keys[0].replace("ToolCall", "");
  }
  return "unknown";
}

function extractDescription(toolCall: CursorToolCallPayload): string {
  for (const value of Object.values(toolCall)) {
    if (typeof value === "object" && value !== null) {
      const v = value as Record<string, unknown>;
      if (typeof v.description === "string") return v.description;
      if (
        typeof v.args === "object" &&
        v.args !== null &&
        typeof (v.args as Record<string, unknown>).description === "string"
      ) {
        return (v.args as Record<string, unknown>).description as string;
      }
    }
  }
  return "";
}

function extractArgs(toolCall: CursorToolCallPayload): Record<string, unknown> {
  for (const value of Object.values(toolCall)) {
    if (typeof value === "object" && value !== null) {
      const v = value as Record<string, unknown>;
      if (typeof v.args === "object" && v.args !== null) {
        return v.args as Record<string, unknown>;
      }
    }
  }
  return {};
}

function extractToolResult(
  toolCall: CursorToolCallPayload,
): { success: boolean; resultText: string } {
  for (const value of Object.values(toolCall)) {
    if (typeof value === "object" && value !== null) {
      const v = value as Record<string, unknown>;
      if (typeof v.result === "object" && v.result !== null) {
        const result = v.result as Record<string, unknown>;
        if (typeof result.success === "object" && result.success !== null) {
          const s = result.success as Record<string, unknown>;
          const output =
            (s.stdout as string) ||
            (s.interleavedOutput as string) ||
            (s.output as string) ||
            "";
          return { success: true, resultText: output };
        }
        // If no success key, treat as failure
        return { success: false, resultText: JSON.stringify(result) };
      }
    }
  }
  return { success: true, resultText: "" };
}
