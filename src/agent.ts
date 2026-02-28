import path from "node:path";
import { agentLoop } from "./agent-loop.js";
import {
  getSession,
  setSession,
  clearSession,
  addHistory,
} from "./db.js";
import type { AgentEvent, AgentState, CursorAgentConfig } from "./types.js";

export interface AgentOptions {
  useDb?: boolean;
  /** Override the DB session key. Defaults to resolved cwd. Telegram uses "tg:<chatId>". */
  sessionKey?: string;
}

/**
 * High-level Agent class wrapping the Cursor CLI agent loop.
 * Provides subscribe/prompt/abort interface with internal state tracking.
 * Inspired by pi-mono's Agent class.
 */
export class Agent {
  private _state: AgentState = {
    sessionId: null,
    model: "auto",
    isStreaming: false,
    thinkingText: "",
    messageText: "",
    pendingToolCalls: new Set(),
    error: null,
  };

  private listeners = new Set<(e: AgentEvent) => void>();
  private abortController?: AbortController;
  private useDb: boolean;
  private resolvedCwd: string;

  constructor(
    private config: CursorAgentConfig,
    opts?: AgentOptions,
  ) {
    if (config.model) this._state.model = config.model;
    this.useDb = opts?.useDb ?? false;
    this.resolvedCwd = opts?.sessionKey ?? path.resolve(config.cwd || process.cwd());
  }

  get state(): Readonly<AgentState> {
    return this._state;
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async prompt(text: string): Promise<void> {
    if (this._state.isStreaming) {
      throw new Error("Agent is already processing a prompt.");
    }

    // Auto-resume from DB if no explicit sessionId
    const runConfig = { ...this.config };
    if (this.useDb && !runConfig.sessionId) {
      const saved = getSession(this.resolvedCwd);
      if (saved) {
        runConfig.sessionId = saved.session_id;
      }
    }

    this.abortController = new AbortController();
    this._state.isStreaming = true;
    this._state.error = null;
    this._state.thinkingText = "";
    this._state.messageText = "";
    this._state.pendingToolCalls.clear();

    const startTime = Date.now();

    try {
      const stream = agentLoop(
        text,
        runConfig,
        this.abortController.signal,
      );

      for await (const event of stream) {
        this.updateState(event);
        this.emit(event);

        // Persist session + history on completion
        if (this.useDb && event.type === "agent_end") {
          this.persistCompletion(text, event, startTime);
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      this._state.error = message;
      this.emit({ type: "error", message });
    } finally {
      this._state.isStreaming = false;
      this.abortController = undefined;
    }
  }

  /** Clear the stored session for current cwd, forcing a fresh start. */
  newSession(): void {
    if (this.useDb) {
      clearSession(this.resolvedCwd);
    }
    this._state.sessionId = null;
    this.config.sessionId = undefined;
  }

  abort(): void {
    this.abortController?.abort();
  }

  private persistCompletion(
    promptText: string,
    event: Extract<AgentEvent, { type: "agent_end" }>,
    startTime: number,
  ): void {
    try {
      setSession(this.resolvedCwd, event.sessionId, {
        lastPrompt: promptText,
        lastResult: event.result.slice(0, 1000),
        model: this._state.model,
      });

      addHistory({
        cwd: this.resolvedCwd,
        session_id: event.sessionId,
        prompt: promptText,
        result: event.result.slice(0, 2000),
        model: this._state.model,
        input_tokens: event.usage.inputTokens,
        output_tokens: event.usage.outputTokens,
        duration_ms: Date.now() - startTime,
        created_at: new Date().toISOString(),
      });
    } catch {
      // DB persistence is best-effort — don't break the agent loop
    }
  }

  private updateState(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this._state.sessionId = event.sessionId;
        this._state.model = event.model;
        break;
      case "thinking_delta":
        this._state.thinkingText += event.text;
        break;
      case "message_delta":
        this._state.messageText += event.text;
        break;
      case "message_end":
        this._state.messageText = event.text;
        break;
      case "tool_start":
        this._state.pendingToolCalls.add(event.callId);
        break;
      case "tool_end":
        this._state.pendingToolCalls.delete(event.callId);
        break;
      case "agent_end":
        this._state.isStreaming = false;
        break;
      case "error":
        this._state.error = event.message;
        break;
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
