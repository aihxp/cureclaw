import { execSync } from "node:child_process";
import type { CiStatus } from "../types.js";

export interface PrStatusResult {
  prNumber: number | null;
  ciStatus: CiStatus;
  checks: Array<{ name: string; status: string }>;
  url: string | null;
}

export function isGhAvailable(): boolean {
  try {
    execSync("gh --version", { encoding: "utf-8", timeout: 5_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkPrStatus(branch: string): PrStatusResult {
  try {
    const raw = execSync(
      `gh pr view "${branch}" --json number,state,statusCheckRollup,url`,
      { encoding: "utf-8", timeout: 30_000, stdio: "pipe" },
    );

    const data = JSON.parse(raw) as {
      number: number;
      state: string;
      statusCheckRollup: Array<{ name: string; conclusion: string; status: string }> | null;
      url: string;
    };

    const checks: Array<{ name: string; status: string }> = [];
    let ciStatus: CiStatus = "unknown";

    if (data.statusCheckRollup && data.statusCheckRollup.length > 0) {
      let allPassed = true;
      let anyFailed = false;
      let anyPending = false;

      for (const check of data.statusCheckRollup) {
        const status = check.conclusion || check.status || "unknown";
        checks.push({ name: check.name, status });

        if (status === "SUCCESS" || status === "success") {
          // pass
        } else if (status === "FAILURE" || status === "failure" || status === "ERROR" || status === "error") {
          anyFailed = true;
          allPassed = false;
        } else {
          anyPending = true;
          allPassed = false;
        }
      }

      if (anyFailed) ciStatus = "failing";
      else if (allPassed) ciStatus = "passing";
      else if (anyPending) ciStatus = "pending";
    }

    return { prNumber: data.number, ciStatus, checks, url: data.url };
  } catch {
    return { prNumber: null, ciStatus: "unknown", checks: [], url: null };
  }
}

export function getCiFailureLogs(branch: string): string {
  try {
    const raw = execSync(
      `gh pr checks "${branch}" --json name,conclusion,detailsUrl`,
      { encoding: "utf-8", timeout: 30_000, stdio: "pipe" },
    );

    const checks = JSON.parse(raw) as Array<{
      name: string;
      conclusion: string;
      detailsUrl: string;
    }>;

    const failures = checks.filter(
      (c) => c.conclusion === "FAILURE" || c.conclusion === "failure",
    );

    if (failures.length === 0) return "No CI failures found.";

    const logs: string[] = [];
    for (const f of failures) {
      logs.push(`--- ${f.name} (${f.conclusion}) ---`);

      // Try to get run logs
      try {
        const urlParts = f.detailsUrl?.match(/\/runs\/(\d+)/);
        if (urlParts) {
          const runLog = execSync(
            `gh run view ${urlParts[1]} --log-failed 2>/dev/null | tail -100`,
            { encoding: "utf-8", timeout: 30_000, stdio: "pipe" },
          );
          logs.push(runLog.slice(0, 2000));
        }
      } catch {
        logs.push("(could not retrieve failure logs)");
      }
    }

    return logs.join("\n").slice(0, 4000);
  } catch {
    return "Could not retrieve CI failure information.";
  }
}

export function createPrIfMissing(branch: string): number | null {
  try {
    // Check if PR already exists
    const existing = execSync(
      `gh pr view "${branch}" --json number`,
      { encoding: "utf-8", timeout: 15_000, stdio: "pipe" },
    );
    const data = JSON.parse(existing) as { number: number };
    return data.number;
  } catch {
    // No PR exists, create one
    try {
      const result = execSync(
        `gh pr create --head "${branch}" --title "feat: ${branch}" --body "Auto-created by CureClaw monitor" --fill`,
        { encoding: "utf-8", timeout: 30_000, stdio: "pipe" },
      );
      const prMatch = result.match(/\/pull\/(\d+)/);
      return prMatch ? parseInt(prMatch[1], 10) : null;
    } catch {
      return null;
    }
  }
}

export function postPrComment(prNumber: number, body: string): void {
  try {
    execSync(
      `gh pr comment ${prNumber} --body ${JSON.stringify(body)}`,
      { encoding: "utf-8", timeout: 15_000, stdio: "pipe" },
    );
  } catch {
    // Non-fatal
  }
}
