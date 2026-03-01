import type { CommandResult } from "../scheduler/commands.js";
import { remember, recall, forget, formatMemoryList, formatMemoryDetail } from "./memory.js";

/**
 * Handle /remember, /recall, /forget commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleMemoryCommand(input: string): CommandResult | null {
  const trimmed = input.trim();

  if (trimmed === "/remember" || trimmed.startsWith("/remember ")) {
    return handleRemember(trimmed.slice(9).trim());
  }

  if (trimmed === "/recall" || trimmed.startsWith("/recall ")) {
    const query = trimmed.slice(7).trim();
    return handleRecall(query);
  }

  if (trimmed === "/forget" || trimmed.startsWith("/forget ")) {
    return handleForget(trimmed.slice(7).trim());
  }

  if (trimmed === "/memory help" || trimmed === "/memory") {
    return {
      text: [
        "Memory commands:",
        '  /remember <key> <content> [--tags tag1,tag2]   Store a memory',
        "  /recall [query]                                 Search memories (or list all)",
        "  /forget <key>                                   Remove a memory",
        "  /memory help                                    Show this help",
      ].join("\n"),
    };
  }

  return null;
}

function handleRemember(args: string): CommandResult {
  if (!args) {
    return { text: "Usage: /remember <key> <content> [--tags tag1,tag2]" };
  }

  // Extract --tags flag
  let tags: string[] | undefined;
  let cleaned = args;
  const tagsMatch = cleaned.match(/--tags\s+(\S+)/);
  if (tagsMatch) {
    tags = tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
    cleaned = cleaned.replace(/--tags\s+\S+/, "").trim();
  }

  // Split into key and content
  const spaceIdx = cleaned.indexOf(" ");
  if (spaceIdx === -1) {
    return { text: "Usage: /remember <key> <content>" };
  }

  const key = cleaned.slice(0, spaceIdx);
  const content = cleaned.slice(spaceIdx + 1).trim();

  if (!content) {
    return { text: "Usage: /remember <key> <content>" };
  }

  const memory = remember(key, content, { tags, source: "user" });
  return { text: `Remembered "${memory.key}": ${memory.content.slice(0, 60)}` };
}

function handleRecall(query: string): CommandResult {
  if (!query) {
    const memories = recall("");
    return { text: formatMemoryList(memories) };
  }

  const memories = recall(query);
  if (memories.length === 0) {
    return { text: `No memories matching "${query}".` };
  }

  if (memories.length === 1) {
    return { text: formatMemoryDetail(memories[0]) };
  }

  return { text: formatMemoryList(memories) };
}

function handleForget(key: string): CommandResult {
  if (!key) {
    return { text: "Usage: /forget <key>" };
  }

  const removed = forget(key);
  if (removed) {
    return { text: `Forgot "${key}".` };
  }
  return { text: `No memory with key "${key}".` };
}
