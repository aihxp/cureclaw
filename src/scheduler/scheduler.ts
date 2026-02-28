import { Agent } from "../agent.js";
import { getCloudClient } from "../cloud/client.js";
import { getDueJobs, updateJob } from "../db.js";
import type { AgentEvent, CursorAgentConfig, Job } from "../types.js";
import { computeNextRun } from "./compute-next-run.js";
import { deliver } from "./delivery.js";

const TICK_MAX_MS = 60_000;
const BACKOFF_DELAYS = [30_000, 60_000, 300_000, 900_000, 3_600_000];

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private executing = false;
  private config: CursorAgentConfig;

  constructor(config: CursorAgentConfig) {
    this.config = config;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[scheduler] Started");
    this.arm();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[scheduler] Stopped");
  }

  private arm(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);

    // Find the soonest due job to compute optimal delay
    const now = new Date();
    const dueJobs = getDueJobs(now);

    let delay: number;
    if (dueJobs.length > 0) {
      delay = 0; // Jobs due now, execute immediately
    } else {
      delay = TICK_MAX_MS;
    }

    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.executing) return;
    this.executing = true;

    try {
      const now = new Date();
      const dueJobs = getDueJobs(now);

      for (const job of dueJobs) {
        if (!this.running) break;
        await this.executeJob(job);
      }
    } catch (err) {
      console.error("[scheduler] Tick error:", err);
    } finally {
      this.executing = false;
      this.arm();
    }
  }

  private async executeJob(job: Job): Promise<void> {
    console.log(`[scheduler] Executing job ${job.id}: "${job.name}"`);

    const runAt = new Date().toISOString();
    let result = "";
    let error = "";

    // Try Cloud API path for cloud jobs with a repository
    const cloudClient = job.cloud && job.repository ? getCloudClient() : null;
    if (cloudClient && job.repository) {
      try {
        const launched = await cloudClient.launchAgent({
          prompt: { text: job.prompt },
          source: { repository: job.repository },
        });
        console.log(`[scheduler] Cloud agent ${launched.id} launched for job ${job.id}`);

        const finished = await cloudClient.pollUntilDone(launched.id);
        if (finished.status === "FINISHED") {
          const conv = await cloudClient.getConversation(launched.id);
          const assistantMsgs = conv.messages
            .filter((m) => m.type === "assistant_message")
            .map((m) => m.text);
          result = assistantMsgs.join("\n\n") || finished.summary || "(no output)";
        } else {
          error = `Cloud agent ${finished.status}: ${finished.summary || "unknown error"}`;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[scheduler] Cloud API failed for job ${job.id}, falling back to local: ${msg}`);
        // Fall through to local subprocess path
        error = "";
        result = "";
        await this.executeJobLocal(job, (r) => { result = r; }, (e) => { error = e; });
      }
    } else {
      await this.executeJobLocal(job, (r) => { result = r; }, (e) => { error = e; });
    }

    const success = !error;
    const consecutiveErrors = success ? 0 : job.consecutiveErrors + 1;

    // Compute next run
    let nextRunAt: string | null;
    if (job.schedule.kind === "at") {
      // One-shot: disable after execution
      nextRunAt = null;
    } else if (!success) {
      // Error backoff
      const backoffIdx = Math.min(consecutiveErrors - 1, BACKOFF_DELAYS.length - 1);
      const backoffMs = BACKOFF_DELAYS[backoffIdx];
      nextRunAt = new Date(Date.now() + backoffMs).toISOString();
    } else {
      nextRunAt = computeNextRun(job.schedule, new Date());
    }

    updateJob(job.id, {
      lastRunAt: runAt,
      lastStatus: success ? "success" : "error",
      lastError: error || null,
      lastResult: (result || "").slice(0, 2000) || null,
      consecutiveErrors,
      nextRunAt,
      enabled: job.schedule.kind === "at" ? false : job.enabled,
    });

    // Deliver result
    const deliveryText = success
      ? `Job ${job.id} completed:\n\n${result || "(no output)"}`
      : `Job ${job.id} failed:\n\n${error}`;

    try {
      await deliver(job.delivery, deliveryText);
    } catch (err) {
      console.error(`[scheduler] Delivery failed for job ${job.id}:`, err);
    }

    console.log(
      `[scheduler] Job ${job.id} ${success ? "completed" : "failed"}${nextRunAt ? `, next run: ${nextRunAt}` : ""}`,
    );
  }

  private async executeJobLocal(
    job: Job,
    onResult: (result: string) => void,
    onError: (error: string) => void,
  ): Promise<void> {
    const agentConfig: CursorAgentConfig = {
      ...this.config,
      cloud: job.cloud || this.config.cloud,
    };

    const agent = new Agent(agentConfig, {
      useDb: true,
      sessionKey: `job:${job.id}`,
    });

    let result = "";
    let error = "";

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === "message_end" && event.text) {
        result += (result ? "\n\n" : "") + event.text;
      }
      if (event.type === "error") {
        error = event.message;
      }
    });

    try {
      await agent.prompt(job.prompt);
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      unsubscribe();
    }

    onResult(result);
    if (error) onError(error);
  }
}
