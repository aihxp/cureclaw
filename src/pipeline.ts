import type { Pipeline } from "./types.js";

/**
 * Interpolate template variables in a prompt string.
 * {{prev}} → previous step result
 * {{step.N}} → result from step N (0-indexed)
 * Unresolved references are left as-is.
 */
export function interpolatePrompt(
  template: string,
  stepResults: Map<number, string>,
  prevResult: string,
): string {
  let result = template.replace(/\{\{prev\}\}/g, prevResult);
  result = result.replace(/\{\{step\.(\d+)\}\}/g, (_match, n) => {
    const idx = parseInt(n, 10);
    return stepResults.get(idx) ?? `{{step.${n}}}`;
  });
  return result;
}

/**
 * Parse pipeline arguments from a command string.
 * Format: "step1" [--reflect] "step2" [--reflect] "step3"
 * --reflect applies to the PRECEDING prompt.
 * Returns null if parsing fails.
 */
export function parsePipelineArgs(args: string): Pipeline | null {
  const steps: Pipeline["steps"] = [];
  let remaining = args.trim();

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (!remaining) break;

    if (remaining.startsWith("--reflect")) {
      // Apply to last step
      if (steps.length > 0) {
        steps[steps.length - 1].reflect = true;
      }
      remaining = remaining.slice(9).trimStart();
      continue;
    }

    // Parse quoted string
    if (remaining.startsWith('"')) {
      const end = findClosingQuote(remaining, 1);
      if (end === -1) return null;
      const prompt = remaining.slice(1, end).replace(/\\"/g, '"');
      steps.push({ prompt });
      remaining = remaining.slice(end + 1).trimStart();
      continue;
    }

    // Unrecognized token
    return null;
  }

  if (steps.length === 0) return null;
  return { steps };
}

function findClosingQuote(str: string, start: number): number {
  for (let i = start; i < str.length; i++) {
    if (str[i] === "\\" && i + 1 < str.length) {
      i++; // Skip escaped character
      continue;
    }
    if (str[i] === '"') return i;
  }
  return -1;
}
