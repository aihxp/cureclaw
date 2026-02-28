import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: "workspace" | "project" | "global";
}

/**
 * Parse SKILL.md frontmatter (--- delimited YAML-like block).
 * Extracts name and description without a YAML library.
 */
export function parseSkillFrontmatter(
  content: string,
): { name: string; description: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const block = match[1];
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const descMatch = block.match(/^description:\s*"?([^"]*)"?\s*$/m);

  if (!nameMatch) return null;

  return {
    name: nameMatch[1].trim(),
    description: descMatch ? descMatch[1].trim() : "",
  };
}

/**
 * Discover skills from standard paths:
 * 1. workspace/.agents/skills/ (workspace)
 * 2. workspace/.cursor/skills/ (project)
 * 3. ~/.cursor/skills/ (global)
 *
 * Earlier sources take priority for name deduplication.
 */
export function discoverSkills(workspace?: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  const scanDirs: Array<{ dir: string; source: SkillInfo["source"] }> = [];

  if (workspace) {
    scanDirs.push({ dir: path.join(workspace, ".agents", "skills"), source: "workspace" });
    scanDirs.push({ dir: path.join(workspace, ".cursor", "skills"), source: "project" });
  }
  scanDirs.push({ dir: path.join(os.homedir(), ".cursor", "skills"), source: "global" });

  for (const { dir, source } of scanDirs) {
    if (!fs.existsSync(dir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue;

      const skillMdPath = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, "utf-8");
        const meta = parseSkillFrontmatter(content);
        if (meta) {
          seen.add(entry.name);
          skills.push({
            name: meta.name,
            description: meta.description,
            path: path.join(dir, entry.name),
            source,
          });
        }
      } catch {
        // Skip unreadable skills
      }
    }
  }

  return skills;
}
