import type { CursorAgentConfig, AdaptiveConfig } from "../types.js";
import { runEvaluator, buildAdaptedPrompt } from "./evaluators.js";

export async function adaptiveRetry(options: {
  prompt: string;
  config: CursorAgentConfig;
  adaptiveConfig: AdaptiveConfig;
  sessionKey: string;
  branch?: string;
}): Promise<{ success: boolean; attempts: number; result: string }> {
  const { Agent } = await import("../agent.js");
  const { startRun, completeRun } = await import("../fleet/registry.js");

  const maxRetries = options.adaptiveConfig.maxRetries;
  let currentPrompt = options.prompt;
  let lastResult = "";

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const run = startRun({
      kind: "adaptive",
      label: `adaptive:${options.sessionKey} (attempt ${attempt})`,
    });

    const agent = new Agent(options.config, {
      useDb: true,
      sessionKey: `${options.sessionKey}:${attempt}`,
    });

    try {
      await agent.prompt(currentPrompt);
      lastResult = agent.state.messageText || "(no response)";
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      completeRun(run.id, { status: "error", error: errMsg });
      lastResult = `Error: ${errMsg}`;

      if (attempt > maxRetries) {
        return { success: false, attempts: attempt, result: lastResult };
      }

      currentPrompt = buildAdaptedPrompt(options.prompt, errMsg, attempt + 1);
      continue;
    }

    // Run evaluator
    const evalResult = await runEvaluator(
      {
        ...options.adaptiveConfig,
        evaluatorArg: options.adaptiveConfig.evaluatorArg ?? options.branch,
      },
      options.config.cwd,
    );

    if (evalResult.passed) {
      completeRun(run.id, { status: "success", result: lastResult.slice(0, 500) });
      return { success: true, attempts: attempt, result: lastResult };
    }

    completeRun(run.id, {
      status: "error",
      error: `Evaluator failed: ${evalResult.context.slice(0, 200)}`,
    });

    if (attempt > maxRetries) {
      return { success: false, attempts: attempt, result: lastResult };
    }

    // Build adapted prompt with failure context
    currentPrompt = buildAdaptedPrompt(options.prompt, evalResult.context, attempt + 1);
  }

  return { success: false, attempts: maxRetries + 1, result: lastResult };
}
