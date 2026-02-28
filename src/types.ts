// ============================================================================
// Cursor CLI stream-json output types (what cursor agent emits on stdout)
// ============================================================================

export interface CursorSystemEvent {
  type: "system";
  subtype: "init";
  apiKeySource: string;
  cwd: string;
  session_id: string;
  model: string;
  permissionMode: string;
}

export interface CursorUserEvent {
  type: "user";
  message: {
    role: "user";
    content: Array<{ type: "text"; text: string }>;
  };
  session_id: string;
}

export interface CursorThinkingDeltaEvent {
  type: "thinking";
  subtype: "delta";
  text: string;
  session_id: string;
  timestamp_ms: number;
}

export interface CursorThinkingCompletedEvent {
  type: "thinking";
  subtype: "completed";
  session_id: string;
  timestamp_ms: number;
}

export type CursorThinkingEvent =
  | CursorThinkingDeltaEvent
  | CursorThinkingCompletedEvent;

export interface CursorAssistantEvent {
  type: "assistant";
  message: {
    role: "assistant";
    content: Array<{ type: "text"; text: string }>;
  };
  session_id: string;
  model_call_id?: string;
  timestamp_ms?: number; // present on partial deltas, absent on final
}

export interface CursorToolCallPayload {
  shellToolCall?: {
    args: Record<string, unknown>;
    result?: Record<string, unknown>;
    description?: string;
  };
  // Cursor has other tool types (fileEditToolCall, readToolCall, etc.)
  [key: string]: unknown;
}

export interface CursorToolCallStartedEvent {
  type: "tool_call";
  subtype: "started";
  call_id: string;
  tool_call: CursorToolCallPayload;
  model_call_id: string;
  session_id: string;
  timestamp_ms: number;
}

export interface CursorToolCallCompletedEvent {
  type: "tool_call";
  subtype: "completed";
  call_id: string;
  tool_call: CursorToolCallPayload;
  model_call_id: string;
  session_id: string;
  timestamp_ms: number;
}

export type CursorToolCallEvent =
  | CursorToolCallStartedEvent
  | CursorToolCallCompletedEvent;

export interface CursorUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CursorResultEvent {
  type: "result";
  subtype: "success" | "error";
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  result: string;
  session_id: string;
  request_id: string;
  usage: CursorUsage;
}

export type CursorStreamEvent =
  | CursorSystemEvent
  | CursorUserEvent
  | CursorThinkingEvent
  | CursorAssistantEvent
  | CursorToolCallEvent
  | CursorResultEvent;

// ============================================================================
// CureClaw AgentEvents (Pi-Mono style, what we expose to consumers)
// ============================================================================

export type AgentEvent =
  | { type: "agent_start"; sessionId: string; model: string }
  | {
      type: "agent_end";
      sessionId: string;
      result: string;
      usage: CursorUsage;
      durationMs: number;
    }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_end" }
  | { type: "message_start" }
  | { type: "message_delta"; text: string }
  | { type: "message_end"; text: string }
  | {
      type: "tool_start";
      callId: string;
      toolName: string;
      description: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      callId: string;
      toolName: string;
      success: boolean;
      result: string;
    }
  | { type: "error"; message: string };

// ============================================================================
// Configuration
// ============================================================================

export interface CursorAgentConfig {
  /** Path to cursor CLI binary */
  cursorPath: string;
  /** Model to use (e.g., "sonnet-4", "gpt-5", "sonnet-4-thinking") */
  model?: string;
  /** Working directory for cursor agent */
  cwd?: string;
  /** Auto-approve all tool calls (--yolo) */
  autoApprove?: boolean;
  /** Stream partial text output (--stream-partial-output) */
  streamPartialOutput?: boolean;
  /** Resume a specific Cursor session by chatId */
  sessionId?: string;
  /** Run in Cursor cloud mode (--cloud) */
  cloud?: boolean;
  /** Additional CLI args */
  extraArgs?: string[];
}

export interface AgentState {
  sessionId: string | null;
  model: string;
  isStreaming: boolean;
  thinkingText: string;
  messageText: string;
  pendingToolCalls: Set<string>;
  error: string | null;
}

// ============================================================================
// Scheduler types
// ============================================================================

export type JobSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number }
  | { kind: "cron"; expr: string };

export type DeliveryTarget =
  | { kind: "store" }
  | { kind: "channel"; channelType: string; channelId: string };

export interface Job {
  id: string;
  name: string;
  prompt: string;
  schedule: JobSchedule;
  delivery: DeliveryTarget;
  cloud: boolean;
  repository?: string;
  enabled: boolean;
  createdAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "success" | "error" | null;
  lastError: string | null;
  lastResult: string | null;
  consecutiveErrors: number;
}
