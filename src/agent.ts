import { agentLoop } from "./agent-loop.js";
import type { AgentEvent, AgentState, CursorAgentConfig } from "./types.js";

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

  constructor(private config: CursorAgentConfig) {
    if (config.model) this._state.model = config.model;
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

    this.abortController = new AbortController();
    this._state.isStreaming = true;
    this._state.error = null;
    this._state.thinkingText = "";
    this._state.messageText = "";
    this._state.pendingToolCalls.clear();

    try {
      const stream = agentLoop(
        text,
        this.config,
        this.abortController.signal,
      );

      for await (const event of stream) {
        this.updateState(event);
        this.emit(event);
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

  abort(): void {
    this.abortController?.abort();
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
