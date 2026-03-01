import type { Memory } from "../types.js";
import {
  addMemory,
  getMemoryByKey,
  searchMemory,
  getAllMemories,
  updateMemory,
  removeMemory,
} from "../db.js";

/**
 * Store a new memory. If key exists, updates content instead.
 */
export function remember(
  key: string,
  content: string,
  opts?: { tags?: string[]; source?: string },
): Memory {
  const now = new Date().toISOString();
  const existing = getMemoryByKey(key);

  if (existing) {
    updateMemory(existing.id, {
      content,
      tags: opts?.tags ?? existing.tags,
      updatedAt: now,
    });
    return {
      ...existing,
      content,
      tags: opts?.tags ?? existing.tags,
      updatedAt: now,
    };
  }

  return addMemory({
    key,
    content,
    tags: opts?.tags ?? [],
    source: opts?.source ?? "user",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Search memories by query string (matches key, content, tags).
 */
export function recall(query: string): Memory[] {
  if (!query.trim()) return getAllMemories();
  return searchMemory(query);
}

/**
 * Remove a memory by key. Returns true if removed.
 */
export function forget(key: string): boolean {
  const existing = getMemoryByKey(key);
  if (!existing) return false;
  return removeMemory(existing.id);
}

/**
 * Get all memories, optionally filtered by tag.
 */
export function listMemories(tag?: string): Memory[] {
  const all = getAllMemories();
  if (!tag) return all;
  return all.filter((m) => m.tags.includes(tag));
}

/**
 * Format memories for display.
 */
export function formatMemoryList(memories: Memory[]): string {
  if (memories.length === 0) return "No memories found.";

  const lines = ["Memories:\n"];
  for (const m of memories) {
    const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
    lines.push(`  ${m.key}: ${m.content.slice(0, 80)}${m.content.length > 80 ? "..." : ""}${tags}`);
  }
  return lines.join("\n");
}

/**
 * Format a single memory for display.
 */
export function formatMemoryDetail(memory: Memory): string {
  const tags = memory.tags.length > 0 ? `\nTags: ${memory.tags.join(", ")}` : "";
  return `Key: ${memory.key}\nContent: ${memory.content}${tags}\nSource: ${memory.source}\nCreated: ${memory.createdAt}\nUpdated: ${memory.updatedAt}`;
}

/**
 * Build a context string from relevant memories for injection into prompts.
 */
export function buildMemoryContext(query: string): string {
  const memories = query ? searchMemory(query) : getAllMemories();
  if (memories.length === 0) return "(no relevant memories)";

  const top = memories.slice(0, 5);
  const lines = ["## Relevant Memories\n"];
  for (const m of top) {
    lines.push(`- **${m.key}**: ${m.content}`);
  }
  return lines.join("\n");
}
