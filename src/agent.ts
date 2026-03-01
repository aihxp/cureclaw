import path from "node:path";
import { agentLoop } from "./agent-loop.js";
import {
  getSession,
  setSession,
  clearSession,
  addHistory,
} from "./db.js";
import { SteeringQueue } from "./steering.js";
import { buildReflectionPrompt, isReflectionPass } from "./reflection.js";
import { interpolatePrompt } from "./pipeline.js";
import { resolveWorkstation } from "./workstation.js";
import type { CursorMode } from "./mode.js";
import type { ImageAttachment } from "./images.js";
import type { AgentEvent, AgentState, CursorAgentConfig, Pipeline, Workstation } from "./types.js";

export interface AgentOptions {
  useDb?: boolean;
  /** Override the DB session key. Defaults to resolved cwd. Telegram uses "tg:<chatId>". */
  sessionKey?: string;
  /** Enable reflection for all prompts. Pass a string for a custom reflection prompt. */
  reflect?: boolean | string;
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
    mode: "agent",
    isStreaming: false,
    thinkingText: "",
    messageText: "",
    pendingToolCalls: new Set(),
    error: null,
    queueDepth: 0,
  };

  private listeners = new Set<(e: AgentEvent) => void>();
  private abortController?: AbortController;
  private useDb: boolean;
  private resolvedCwd: string;
  private steeringQueue = new SteeringQueue();
  private reflectConfig: boolean | string;
  private workstation: Workstation | undefined;

  constructor(
    private config: CursorAgentConfig,
    opts?: AgentOptions,
  ) {
    if (config.model) this._state.model = config.model;
    if (config.mode) this._state.mode = config.mode;
    this.useDb = opts?.useDb ?? false;
    this.reflectConfig = opts?.reflect ?? false;

    // Resolve workstation
    this.workstation = config.workstation
      ? resolveWorkstation(config.workstation)
      : undefined;

    // Session key: prefix with ws:<name>: for workstation isolation
    let baseKey = opts?.sessionKey ?? path.resolve(config.cwd || process.cwd());
    if (this.workstation) {
      baseKey = `ws:${this.workstation.name}:${baseKey}`;
    }
    this.resolvedCwd = baseKey;
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

  /** Add a follow-up prompt to the steering queue. */
  queueFollowUp(prompt: string): void {
    this.steeringQueue.enqueue(prompt);
    this._state.queueDepth = this.steeringQueue.length;
  }

  /** Number of queued follow-up prompts. */
  get queuedCount(): number {
    return this.steeringQueue.length;
  }

  /** Discard all queued follow-ups. */
  clearQueue(): void {
    this.steeringQueue.clear();
    this._state.queueDepth = 0;
  }

  /** Switch the agent's mode (agent/plan/ask). */
  setMode(mode: CursorMode): void {
    this.config = { ...this.config, mode };
    this._state.mode = mode;
  }

  async prompt(text: string, opts?: { reflect?: boolean | string; mode?: CursorMode; images?: ImageAttachment[] }): Promise<void> {
    if (this._state.isStreaming) {
      throw new Error("Agent is already processing a prompt.");
    }

    // Auto-resume from DB if no explicit sessionId
    const runConfig = { ...this.config };
    if (opts?.mode) runConfig.mode = opts.mode;
    if (this.useDb && !runConfig.sessionId) {
      const saved = getSession(this.resolvedCwd);
      if (saved) {
        runConfig.sessionId = saved.session_id;
      }
    }

    const result = await this.runStream(text, runConfig);

    // If the resumed session has corrupted history, clear it and retry fresh
    if (result.corruptSession && runConfig.sessionId) {
      this.newSession();
      const freshConfig = { ...this.config, sessionId: undefined };
      await this.runStream(text, freshConfig);
    }

    // Reflection pass (on success only, single pass, no recursion)
    const shouldReflect = opts?.reflect ?? this.reflectConfig;
    if (shouldReflect && !result.error) {
      await this.runReflection(shouldReflect, runConfig);
    }

    // Drain steering queue (auto-feed follow-ups)
    await this.drainQueue(runConfig);
  }

  /** Execute a multi-step pipeline within a single session. */
  async runPipeline(pipeline: Pipeline): Promise<void> {
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

    this.emit({ type: "pipeline_start", stepCount: pipeline.steps.length });

    const stepResults = new Map<number, string>();
    let prevResult = "";

    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      const interpolated = interpolatePrompt(step.prompt, stepResults, prevResult);

      this.emit({ type: "step_start", stepIndex: i, prompt: interpolated });

      await this.runStream(interpolated, {
        ...runConfig,
        sessionId: this._state.sessionId ?? runConfig.sessionId,
      });

      prevResult = this._state.messageText;
      stepResults.set(i, prevResult);

      if (step.reflect) {
        await this.runReflection(true, {
          ...runConfig,
          sessionId: this._state.sessionId ?? runConfig.sessionId,
        });
      }

      this.emit({ type: "step_end", stepIndex: i });
    }

    this.emit({ type: "pipeline_end" });
    await this.drainQueue(runConfig);
  }

  private async runStream(
    text: string,
    runConfig: CursorAgentConfig,
  ): Promise<{ corruptSession: boolean; error: boolean }> {
    this.abortController = new AbortController();
    this._state.isStreaming = true;
    this._state.error = null;
    this._state.thinkingText = "";
    this._state.messageText = "";
    this._state.pendingToolCalls.clear();

    // System prompt injection from identity
    let promptText = text;
    try {
      const { getSystemPrompt } = await import("./identity/identity.js");
      const channelType = this.resolvedCwd.startsWith("tg:") ? "telegram"
        : this.resolvedCwd.startsWith("wa:") ? "whatsapp"
        : this.resolvedCwd.startsWith("slack:") ? "slack"
        : this.resolvedCwd.startsWith("discord:") ? "discord"
        : undefined;
      const systemPrompt = getSystemPrompt(channelType);
      if (systemPrompt) {
        promptText = `[System: ${systemPrompt}]\n\n${text}`;
      }
    } catch {
      // Identity module not available — skip
    }

    const startTime = Date.now();
    let corruptSession = false;

    try {
      const stream = agentLoop(
        promptText,
        runConfig,
        this.abortController.signal,
        this.workstation,
      );

      for await (const event of stream) {
        // Detect corrupted session history before emitting
        if (
          event.type === "error" &&
          runConfig.sessionId &&
          isCorruptSessionError(event.message)
        ) {
          corruptSession = true;
          break;
        }

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
      if (runConfig.sessionId && isCorruptSessionError(message)) {
        corruptSession = true;
      } else {
        this._state.error = message;
        this.emit({ type: "error", message });
      }
    } finally {
      this._state.isStreaming = false;
      this.abortController = undefined;
    }

    return { corruptSession, error: !!this._state.error };
  }

  private async runReflection(
    reflectOpt: boolean | string,
    runConfig: CursorAgentConfig,
  ): Promise<void> {
    const reflectionPrompt = buildReflectionPrompt(
      typeof reflectOpt === "string" ? reflectOpt : undefined,
    );
    this.emit({ type: "reflection_start" });
    await this.runStream(reflectionPrompt, {
      ...runConfig,
      sessionId: this._state.sessionId ?? runConfig.sessionId,
    });
    const passed = isReflectionPass(this._state.messageText);
    this.emit({ type: "reflection_end", passed });
  }

  private async drainQueue(runConfig: CursorAgentConfig): Promise<void> {
    let next: string | undefined;
    while ((next = this.steeringQueue.dequeue()) !== undefined) {
      this._state.queueDepth = this.steeringQueue.length;
      this.emit({ type: "followup_start", prompt: next });
      await this.runStream(next, {
        ...runConfig,
        sessionId: this._state.sessionId ?? runConfig.sessionId,
      });
      this.emit({ type: "followup_end" });
    }
    this._state.queueDepth = 0;
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

/** Detect API errors caused by corrupted conversation history (orphaned tool_result blocks). */
function isCorruptSessionError(message: string): boolean {
  return (
    message.includes("tool_use_id") &&
    message.includes("tool_result") &&
    message.includes("tool_use")
  );
}
