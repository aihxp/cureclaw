import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CommandInfo {
  name: string;       // filename without .md
  description: string;
  template: string;   // markdown body (the prompt template)
  path: string;
  source: "workspace" | "global";
}

/**
 * Parse optional frontmatter and body from .cursor/commands/*.md.
 * If no frontmatter, the entire content is the template.
 */
export function parseCommandFile(content: string): { description: string; template: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n?---\s*\n?/);
  if (!match) {
    return { description: "", template: content.trim() };
  }

  const block = match[1];
  const descMatch = block.match(/^description:\s*"?([^"]*)"?\s*$/m);
  const template = content.slice(match[0].length).trim();

  return {
    description: descMatch ? descMatch[1].trim() : "",
    template,
  };
}

/**
 * Discover commands from .cursor/commands/ (workspace) and ~/.cursor/commands/ (global).
 * Earlier sources take priority for name deduplication.
 */
export function discoverCommands(workspace?: string): CommandInfo[] {
  const commands: CommandInfo[] = [];
  const seen = new Set<string>();

  const scanDirs: Array<{ dir: string; source: CommandInfo["source"] }> = [];

  if (workspace) {
    scanDirs.push({ dir: path.join(workspace, ".cursor", "commands"), source: "workspace" });
  }
  scanDirs.push({ dir: path.join(os.homedir(), ".cursor", "commands"), source: "global" });

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
      const name = entry.name.replace(/\.md$/, "");
      if (seen.has(name)) continue;

      const filePath = path.join(dir, entry.name);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = parseCommandFile(content);
        seen.add(name);
        commands.push({
          name,
          description: parsed.description,
          template: parsed.template,
          path: filePath,
          source,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  return commands;
}
