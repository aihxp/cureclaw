import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SubagentInfo {
  name: string;
  slug: string;           // filename without .md
  description: string;
  model?: string;
  readonly?: boolean;
  isBackground?: boolean;
  path: string;
  source: "workspace" | "global";
}

/**
 * Parse YAML frontmatter from .cursor/agents/*.md files.
 * Extracts name, description, model, readonly, is_background.
 */
export function parseAgentFrontmatter(
  content: string,
): Omit<SubagentInfo, "path" | "source" | "slug"> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const block = match[1];
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const descMatch = block.match(/^description:\s*"?([^"]*)"?\s*$/m);
  const modelMatch = block.match(/^model:\s*(.+)$/m);
  const readonlyMatch = block.match(/^readonly:\s*(true|false)$/m);
  const bgMatch = block.match(/^is_background:\s*(true|false)$/m);

  if (!nameMatch) return null;

  return {
    name: nameMatch[1].trim(),
    description: descMatch ? descMatch[1].trim() : "",
    model: modelMatch ? modelMatch[1].trim() : undefined,
    readonly: readonlyMatch ? readonlyMatch[1] === "true" : undefined,
    isBackground: bgMatch ? bgMatch[1] === "true" : undefined,
  };
}

/**
 * Discover subagents from .cursor/agents/ (workspace) and ~/.cursor/agents/ (global).
 * Earlier sources take priority for name deduplication.
 */
export function discoverAgents(workspace?: string): SubagentInfo[] {
  const agents: SubagentInfo[] = [];
  const seen = new Set<string>();

  const scanDirs: Array<{ dir: string; source: SubagentInfo["source"] }> = [];

  if (workspace) {
    scanDirs.push({ dir: path.join(workspace, ".cursor", "agents"), source: "workspace" });
  }
  scanDirs.push({ dir: path.join(os.homedir(), ".cursor", "agents"), source: "global" });

  for (const { dir, source } of scanDirs) {
    if (!fs.existsSync(dir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const slug = entry.name.replace(/\.md$/, "");
      if (seen.has(slug)) continue;

      const filePath = path.join(dir, entry.name);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const meta = parseAgentFrontmatter(content);
        if (meta) {
          seen.add(slug);
          agents.push({
            ...meta,
            slug,
            path: filePath,
            source,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return agents;
}
