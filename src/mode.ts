export type CursorMode = "agent" | "plan" | "ask";

const VALID_MODES: CursorMode[] = ["agent", "plan", "ask"];

export function isValidMode(s: string): s is CursorMode {
  return VALID_MODES.includes(s as CursorMode);
}

/** Parse ?/! mode prefixes: ?question → ask mode, !instruction → plan mode */
export function parseModePrefix(text: string): { mode: CursorMode; prompt: string } | null {
  if (text.startsWith("?") && text.length > 1) return { mode: "ask", prompt: text.slice(1).trim() };
  if (text.startsWith("!") && text.length > 1) return { mode: "plan", prompt: text.slice(1).trim() };
  return null;
}
