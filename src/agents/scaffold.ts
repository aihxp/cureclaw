import fs from "node:fs";
import path from "node:path";

/**
 * Validate a subagent name.
 * Returns null if valid, an error message string if invalid.
 */
export function validateAgentName(name: string): string | null {
  if (!name) return "Agent name cannot be empty.";
  if (name.length > 64) return "Agent name must be 64 characters or fewer.";
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && !/^[a-z0-9]$/.test(name)) {
    return "Agent name must be lowercase alphanumeric with hyphens, no leading/trailing hyphen.";
  }
  return null;
}

/**
 * Scaffold a new subagent .md file in baseDir.
 * Returns the path to the created file.
 */
export function scaffoldAgent(opts: {
  name: string;
  description?: string;
  model?: string;
  readonly?: boolean;
  baseDir: string;
}): string {
  const nameErr = validateAgentName(opts.name);
  if (nameErr) throw new Error(nameErr);

  const filePath = path.join(opts.baseDir, `${opts.name}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Agent "${opts.name}" already exists at ${filePath}`);
  }

  const description = opts.description || "A CureClaw subagent";
  const model = opts.model || "inherit";
  const readonly = opts.readonly ?? false;

  const content = `---
name: ${opts.name}
description: "${description}"
model: ${model}
readonly: ${readonly}
is_background: false
---
# ${opts.name}

[Agent instructions here.]
`;

  fs.mkdirSync(opts.baseDir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");

  return filePath;
}
