import { execSync } from "node:child_process";
import type { AdaptiveConfig } from "../types.js";
import { checkPrStatus } from "../monitor/checker.js";

export interface EvalResult {
  passed: boolean;
  context: string;
}

export async function runEvaluator(config: AdaptiveConfig, cwd?: string): Promise<EvalResult> {
  switch (config.evaluator) {
    case "ci":
      return evaluateCi(config.evaluatorArg ?? "");
    case "test":
      return evaluateTest(config.evaluatorArg, cwd);
    case "shell":
      return evaluateShell(config.evaluatorArg ?? "echo 'no command'", cwd);
    case "review":
      return { passed: true, context: "" };
    default:
      return { passed: true, context: "" };
  }
}

export function evaluateCi(branch: string): EvalResult {
  if (!branch) return { passed: false, context: "No branch specified for CI evaluation." };

  const status = checkPrStatus(branch);
  if (status.ciStatus === "passing") {
    return { passed: true, context: "" };
  }

  const failedChecks = status.checks
    .filter((c) => c.status === "FAILURE" || c.status === "failure")
    .map((c) => `  - ${c.name}: ${c.status}`)
    .join("\n");

  return {
    passed: false,
    context: `CI status: ${status.ciStatus}\nFailed checks:\n${failedChecks || "(unknown)"}`,
  };
}

export function evaluateTest(command?: string, cwd?: string): EvalResult {
  const cmd = command || "npm test";
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 300_000,
      stdio: "pipe",
    });
    return { passed: true, context: output.slice(-500) };
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr ?? "";
    const stdout = (err as { stdout?: string })?.stdout ?? "";
    const combined = (stdout + "\n" + stderr).trim();
    return {
      passed: false,
      context: combined.slice(-2000),
    };
  }
}

export function evaluateShell(command: string, cwd?: string): EvalResult {
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 120_000,
      stdio: "pipe",
    });
    return { passed: true, context: output.slice(-500) };
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr ?? "";
    const stdout = (err as { stdout?: string })?.stdout ?? "";
    const combined = (stdout + "\n" + stderr).trim();
    return {
      passed: false,
      context: combined.slice(-2000),
    };
  }
}

export function buildAdaptedPrompt(
  originalPrompt: string,
  failureContext: string,
  attempt: number,
): string {
  return [
    `Attempt ${attempt} — the previous attempt failed.`,
    "",
    "Error context:",
    failureContext,
    "",
    `Original task: ${originalPrompt}`,
    "",
    "Fix the issues identified above. Focus on the specific errors rather than rewriting everything.",
  ].join("\n");
}
