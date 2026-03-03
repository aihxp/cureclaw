import { execSync } from "node:child_process";
import type { CursorAgentConfig, DeliveryTarget, ReviewRecord } from "../types.js";
import { addReview, updateReview } from "../db.js";
import { REVIEWER_PERSONAS, getPersonaByName } from "./personas.js";
import { postPrComment } from "../monitor/checker.js";

export async function runReview(
  branch: string,
  options: {
    personas?: string[];
    delivery: DeliveryTarget;
    config: CursorAgentConfig;
    postToGithub?: boolean;
    prNumber?: number;
  },
): Promise<ReviewRecord> {
  const personaNames = options.personas ?? REVIEWER_PERSONAS.map((p) => p.name);
  const personas = personaNames
    .map((n) => getPersonaByName(n))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  if (personas.length === 0) {
    throw new Error("No valid reviewer personas specified.");
  }

  const review = addReview({
    branch,
    prNumber: options.prNumber ?? null,
    models: personaNames,
    delivery: options.delivery,
    status: "running",
  });

  const diff = getDiff(branch);
  if (!diff.trim()) {
    updateReview(review.id, {
      status: "completed",
      summary: "No changes found to review.",
      completedAt: new Date().toISOString(),
    });
    return { ...review, status: "completed", summary: "No changes found to review." };
  }

  try {
    const { Agent } = await import("../agent.js");
    const { startRun, completeRun } = await import("../fleet/registry.js");

    const reviewPromises = personas.map(async (persona) => {
      const run = startRun({
        kind: "review",
        parentId: review.id,
        label: `review:${persona.name}:${branch}`,
      });

      const agentConfig: CursorAgentConfig = {
        ...options.config,
        mode: "ask",
      };

      const agent = new Agent(agentConfig, {
        useDb: false,
        sessionKey: `review:${persona.name}:${branch}:${Date.now()}`,
      });

      const prompt = `[System: ${persona.systemPrompt}]\n\nReview this code diff:\n\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\`\n\nProvide your review.`;

      try {
        await agent.prompt(prompt);
        const result = agent.state.messageText || "(no response)";
        completeRun(run.id, { status: "success", result: result.slice(0, 2000) });
        return { persona: persona.name, label: persona.label, result };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        completeRun(run.id, { status: "error", error: errMsg });
        return { persona: persona.name, label: persona.label, result: `Error: ${errMsg}` };
      }
    });

    const results = await Promise.allSettled(reviewPromises);
    const reviews = results
      .filter((r): r is PromiseFulfilledResult<{ persona: string; label: string; result: string }> => r.status === "fulfilled")
      .map((r) => r.value);

    const summary = aggregateReviewResults(reviews);

    updateReview(review.id, {
      status: "completed",
      summary,
      completedAt: new Date().toISOString(),
    });

    // Post to GitHub PR if requested
    if (options.postToGithub && options.prNumber) {
      postPrComment(options.prNumber, summary);
    }

    return { ...review, status: "completed", summary };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    updateReview(review.id, {
      status: "error",
      summary: `Review failed: ${errMsg}`,
      completedAt: new Date().toISOString(),
    });
    return { ...review, status: "error", summary: `Review failed: ${errMsg}` };
  }
}

export function getDiff(branch: string, base = "main"): string {
  try {
    return execSync(`git diff ${base}...${branch}`, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    try {
      return execSync(`git diff ${base}..${branch}`, {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      return "";
    }
  }
}

export function aggregateReviewResults(
  results: Array<{ persona: string; label: string; result: string }>,
): string {
  const sections = results.map(
    (r) => `## ${r.label}\n\n${r.result}`,
  );

  return `# Code Review Summary\n\n${sections.join("\n\n---\n\n")}`;
}
