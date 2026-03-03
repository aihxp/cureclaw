import type { CursorAgentConfig, DeliveryTarget, Monitor } from "../types.js";
import {
  addMonitor,
  getActiveMonitors,
  updateMonitor,
  findMonitorByIdPrefix,
} from "../db.js";
import { checkPrStatus, getCiFailureLogs, isGhAvailable } from "./checker.js";

export class CiMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: CursorAgentConfig;

  constructor(config: CursorAgentConfig) {
    this.config = config;
  }

  start(): void {
    if (this.timer) return;
    // 2-minute interval
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, 120_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (!isGhAvailable()) return;

    const monitors = getActiveMonitors();
    for (const monitor of monitors) {
      try {
        await this.checkMonitor(monitor);
      } catch {
        // Continue with other monitors
      }
    }
  }

  private async checkMonitor(monitor: Monitor): Promise<void> {
    const result = checkPrStatus(monitor.branch);
    const now = new Date().toISOString();
    const previousStatus = monitor.ciStatus;

    updateMonitor(monitor.id, {
      ciStatus: result.ciStatus,
      lastCheckAt: now,
      prNumber: result.prNumber ?? monitor.prNumber,
    });

    // Notify on status change
    if (result.ciStatus !== previousStatus && result.ciStatus !== "unknown") {
      const notification = `CI status changed for ${monitor.branch}: ${previousStatus} → ${result.ciStatus}`;

      if (monitor.delivery.kind === "channel") {
        try {
          const { deliver } = await import("../scheduler/delivery.js");
          deliver(monitor.delivery, notification);
        } catch {
          // Delivery not available
        }
      }
    }

    // Auto-fix on CI failure
    if (
      result.ciStatus === "failing" &&
      monitor.autoFix &&
      monitor.retryCount < monitor.maxRetries
    ) {
      await this.autoFix(monitor);
    }

    // Mark completed if passing
    if (result.ciStatus === "passing" && previousStatus === "failing") {
      updateMonitor(monitor.id, { status: "completed", stoppedAt: now });
    }
  }

  private async autoFix(monitor: Monitor): Promise<void> {
    const failureLogs = getCiFailureLogs(monitor.branch);

    try {
      const { Agent } = await import("../agent.js");
      const { startRun, completeRun } = await import("../fleet/registry.js");

      // Determine cwd — use worktree if linked
      let cwd = this.config.cwd;
      if (monitor.worktreeId) {
        const { getWorktreeById } = await import("../db.js");
        const wt = getWorktreeById(monitor.worktreeId);
        if (wt && wt.status === "active") {
          cwd = wt.path;
        }
      }

      const agentConfig: CursorAgentConfig = { ...this.config, cwd };
      const agent = new Agent(agentConfig, {
        useDb: true,
        sessionKey: `monitor:${monitor.branch}:${Date.now()}`,
      });

      const run = startRun({
        kind: "monitor",
        label: `auto-fix:${monitor.branch} (attempt ${monitor.retryCount + 1})`,
      });

      const prompt = `CI failed on branch ${monitor.branch}. Fix these errors:\n\n${failureLogs}`;

      try {
        await agent.prompt(prompt);
        completeRun(run.id, {
          status: "success",
          result: agent.state.messageText?.slice(0, 500),
        });
      } catch (err) {
        completeRun(run.id, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      updateMonitor(monitor.id, {
        retryCount: monitor.retryCount + 1,
      });
    } catch {
      // Agent not available
    }
  }
}

export function startMonitor(
  branch: string,
  options: {
    autoFix?: boolean;
    maxRetries?: number;
    delivery: DeliveryTarget;
    worktreeId?: string;
  },
): Monitor {
  return addMonitor({
    branch,
    prNumber: null,
    autoFix: options.autoFix ?? false,
    maxRetries: options.maxRetries ?? 3,
    delivery: options.delivery,
    worktreeId: options.worktreeId ?? null,
    status: "active",
    createdAt: new Date().toISOString(),
  });
}

export function stopMonitor(idPrefix: string): boolean {
  const monitor = findMonitorByIdPrefix(idPrefix);
  if (!monitor) return false;

  updateMonitor(monitor.id, {
    status: "stopped",
    stoppedAt: new Date().toISOString(),
  });
  return true;
}
