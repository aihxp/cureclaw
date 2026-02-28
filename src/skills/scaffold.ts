import fs from "node:fs";
import path from "node:path";

/**
 * Validate a skill name.
 * Returns null if valid, an error message string if invalid.
 * Rules: lowercase, alphanumeric + hyphens, 1-64 chars, no leading/trailing hyphen.
 */
export function validateSkillName(name: string): string | null {
  if (!name) return "Skill name cannot be empty.";
  if (name.length > 64) return "Skill name must be 64 characters or fewer.";
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && !/^[a-z0-9]$/.test(name)) {
    return "Skill name must be lowercase alphanumeric with hyphens, no leading/trailing hyphen.";
  }
  return null;
}

/**
 * Scaffold a new skill directory with SKILL.md template.
 * Returns the path to the created skill directory.
 */
export function scaffoldSkill(opts: {
  name: string;
  description?: string;
  baseDir: string;
}): string {
  const nameErr = validateSkillName(opts.name);
  if (nameErr) throw new Error(nameErr);

  const skillDir = path.join(opts.baseDir, opts.name);
  if (fs.existsSync(skillDir)) {
    throw new Error(`Skill "${opts.name}" already exists at ${skillDir}`);
  }

  const description = opts.description || "A CureClaw skill";

  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });

  const skillMd = `---
name: ${opts.name}
description: "${description}"
---
# ${opts.name}
## Instructions
[Describe what this skill does.]
`;

  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

  return skillDir;
}
