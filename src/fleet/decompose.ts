import type { Subtask } from "../types.js";

/** System prompt for the planner agent. */
export const PLANNER_SYSTEM_PROMPT =
  "You are a task planner. You decompose high-level goals into independent subtasks that can be executed by separate agents in parallel.";

/** Build a planner prompt from a high-level goal. */
export function buildPlannerPrompt(goal: string, workerCount: number): string {
  return `Break down the following goal into ${workerCount} independent subtasks.
Each subtask should be self-contained and can be executed by an independent agent working on the same repository.

Output ONLY a JSON array, no other text:
[
  {"name": "short-name", "task": "detailed task description"},
  ...
]

Goal: ${goal}`;
}

/** Parse planner output into structured subtasks. */
export function parseSubtasks(output: string): Subtask[] {
  // Try to extract JSON array from the output
  // Handle markdown fences: ```json\n[...]\n```
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : output.trim();

  // Try to find a JSON array in the string
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];

    const subtasks: Subtask[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof item.name === "string" &&
        typeof item.task === "string" &&
        item.name.trim() &&
        item.task.trim()
      ) {
        subtasks.push({ name: item.name.trim(), task: item.task.trim() });
      }
    }
    return subtasks;
  } catch {
    return [];
  }
}
