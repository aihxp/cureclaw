/**
 * Reflection — post-execution verification pass.
 * The agent reviews its own output and either confirms LGTM or fixes issues.
 */

export const DEFAULT_REFLECTION_PROMPT =
  "Review your previous response for errors, incomplete work, or issues. " +
  "If everything looks correct, say LGTM. If there are issues, fix them.";

const PASS_SIGNALS = [
  "lgtm",
  "looks good to me",
  "no issues found",
  "everything looks correct",
];

/**
 * Build the reflection prompt string.
 * If a custom string is provided, use it. Otherwise use the default.
 */
export function buildReflectionPrompt(customPrompt?: string): string {
  return customPrompt ?? DEFAULT_REFLECTION_PROMPT;
}

/**
 * Detect whether the reflection response indicates a pass (no issues).
 * Case-insensitive substring match against known pass signals.
 */
export function isReflectionPass(responseText: string): boolean {
  const lower = responseText.toLowerCase();
  return PASS_SIGNALS.some((signal) => lower.includes(signal));
}
