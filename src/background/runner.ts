import type { CursorAgentConfig, BackgroundAgentRecord, Suggestion, BackgroundStatus } from "../types.js";
import {
  addBackgroundAgent,
  getBackgroundAgentByName,
  getAllBackgroundAgents,
  updateBackgroundAgent,
  removeBackgroundAgent as dbRemoveBackgroundAgent,
  addSuggestion,
  getPendingSuggestions,
  updateSuggestion,
} from "../db.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Parse a simple schedule string ("every 30m", "every 1h") into milliseconds.
 * Only supports "every <N><s|m|h|d>" format for background agents.
 */
function parseIntervalMs(schedule: string): number | null {
  const match = schedule.match(/^every\s+(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (multipliers[unit] ?? 0);
}

function isDue(agent: BackgroundAgentRecord): boolean {
  const intervalMs = parseIntervalMs(agent.schedule);
  if (!intervalMs) return false;
  if (!agent.lastRunAt) return true;
  const lastRun = new Date(agent.lastRunAt).getTime();
  return Date.now() - lastRun >= intervalMs;
}

export class BackgroundRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _status: BackgroundStatus = "idle";
  private config: CursorAgentConfig;

  constructor(config: CursorAgentConfig) {
    this.config = config;
  }

  /** Start the background runner (checks for due agents periodically). */
  start(): void {
    if (this._status === "running") return;
    this._status = "running";
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error("[background] Tick error:", err);
      });
    }, CHECK_INTERVAL_MS);
  }

  /** Stop the background runner. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._status = "stopped";
  }

  /** Get runner status. */
  get status(): BackgroundStatus {
    return this._status;
  }

  /** Register a subagent for background execution. */
  register(name: string, schedule: string): BackgroundAgentRecord {
    const existing = getBackgroundAgentByName(name);
    if (existing) {
      throw new Error(`Background agent "${name}" already registered.`);
    }

    const intervalMs = parseIntervalMs(schedule);
    if (!intervalMs) {
      throw new Error(`Invalid schedule "${schedule}". Use format: every <N><s|m|h|d>`);
    }

    return addBackgroundAgent({
      name,
      schedule,
      enabled: true,
      createdAt: new Date().toISOString(),
    });
  }

  /** Unregister a background agent. */
  unregister(name: string): boolean {
    const agent = getBackgroundAgentByName(name);
    if (!agent) return false;
    return dbRemoveBackgroundAgent(agent.id);
  }

  /** Get pending suggestions. */
  getSuggestions(): Suggestion[] {
    return getPendingSuggestions();
  }

  /** Accept a suggestion. */
  acceptSuggestion(id: string): void {
    updateSuggestion(id, "accepted");
  }

  /** Dismiss a suggestion. */
  dismissSuggestion(id: string): void {
    updateSuggestion(id, "dismissed");
  }

  /**
   * Internal tick — check all enabled background agents and run due ones.
   * Exposed for testing.
   */
  async tick(): Promise<void> {
    const agents = getAllBackgroundAgents();
    for (const agent of agents) {
      if (!agent.enabled) continue;
      if (!isDue(agent)) continue;

      try {
        await this.runAgent(agent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateBackgroundAgent(agent.id, {
          lastRunAt: new Date().toISOString(),
          lastResult: `Error: ${msg}`,
        });
      }
    }
  }

  private async runAgent(agent: BackgroundAgentRecord): Promise<void> {
    // Dynamic import to avoid circular dependency
    const { discoverAgents } = await import("../agents/list.js");
    const subagents = discoverAgents();
    const found = subagents.find((s) => s.slug === agent.name || s.name === agent.name);

    if (!found) {
      updateBackgroundAgent(agent.id, {
        lastRunAt: new Date().toISOString(),
        lastResult: `Subagent "${agent.name}" not found`,
      });
      return;
    }

    // Import Agent dynamically to avoid circular deps
    const { Agent } = await import("../agent.js");
    const agentInstance = new Agent(
      { ...this.config, mode: "ask" },
      { useDb: true, sessionKey: `background:${agent.name}` },
    );

    let resultText = "";
    const unsubscribe = agentInstance.subscribe((event) => {
      if (event.type === "message_end" && "text" in event) {
        resultText += event.text;
      }
    });

    const fs = await import("node:fs");
    const content = fs.readFileSync(found.path, "utf-8");
    // Strip frontmatter
    const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
    const prompt = body || `Run background check as ${agent.name}`;

    try {
      await agentInstance.prompt(prompt);
    } finally {
      unsubscribe();
    }

    updateBackgroundAgent(agent.id, {
      lastRunAt: new Date().toISOString(),
      lastResult: resultText.slice(0, 2000),
    });

    // Parse for suggestions (look for lines starting with "- Suggestion:" or similar)
    const suggestionLines = resultText.split("\n").filter((line) =>
      /^\s*[-*]\s*(suggestion|recommend|action|todo)/i.test(line),
    );

    for (const line of suggestionLines) {
      addSuggestion({
        backgroundAgentId: agent.id,
        content: line.replace(/^\s*[-*]\s*/, "").trim(),
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    }
  }
}
