import type { CommandResult } from "../scheduler/commands.js";
import type { CursorAgentConfig, DeliveryTarget } from "../types.js";
import { runReview } from "./review.js";
import { getPersonaNames } from "./personas.js";

interface CommandContext {
  channelType?: string;
  channelId?: string;
}

export function handleReviewCommand(
  input: string,
  ctx?: CommandContext,
  config?: CursorAgentConfig,
): CommandResult | null | Promise<CommandResult> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/review")) return null;

  const rest = trimmed.slice(7).trim();

  if (!rest || rest === "help") {
    return { text: reviewHelp() };
  }

  return doReview(rest, ctx, config);
}

async function doReview(
  args: string,
  ctx?: CommandContext,
  config?: CursorAgentConfig,
): Promise<CommandResult> {
  if (!config) {
    return { text: "Cannot run review: cursor configuration not available." };
  }

  let postToGithub = false;
  let personas: string[] | undefined;

  if (args.includes("--post")) {
    postToGithub = true;
    args = args.replace(/--post/, "").trim();
  }

  const modelsMatch = args.match(/--models\s+(\S+)/);
  if (modelsMatch) {
    personas = modelsMatch[1].split(",").filter(Boolean);
    args = args.replace(modelsMatch[0], "").trim();
  }

  const branch = args.split(/\s+/)[0];
  if (!branch) {
    return { text: "Usage: /review <branch> [--models security,architecture,performance] [--post]" };
  }

  const delivery: DeliveryTarget =
    ctx?.channelType && ctx?.channelId
      ? { kind: "channel", channelType: ctx.channelType, channelId: ctx.channelId }
      : { kind: "store" };

  try {
    const review = await runReview(branch, {
      personas,
      delivery,
      config,
      postToGithub,
    });

    if (review.summary) {
      const truncated = review.summary.length > 3000
        ? review.summary.slice(0, 3000) + "\n\n...(truncated)"
        : review.summary;
      return { text: truncated };
    }

    return { text: `Review completed (id: ${review.id})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error running review: ${msg}` };
  }
}

function reviewHelp(): string {
  const names = getPersonaNames().join(", ");
  return [
    "Review commands:",
    "",
    "  /review <branch> [--models <personas>] [--post]  Run multi-persona code review",
    "",
    `  Available personas: ${names}`,
    "  --post  Post review summary as PR comment on GitHub",
  ].join("\n");
}
