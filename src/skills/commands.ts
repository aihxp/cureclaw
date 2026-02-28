import path from "node:path";
import type { CommandResult } from "../scheduler/commands.js";
import { scaffoldSkill, validateSkillName } from "./scaffold.js";
import { discoverSkills } from "./list.js";

/**
 * Handle /skill and /skills commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleSkillCommand(input: string, workspace: string): CommandResult | null {
  const trimmed = input.trim();

  if (trimmed === "/skills") {
    return listSkills(workspace);
  }

  if (trimmed.startsWith("/skill ")) {
    const rest = trimmed.slice(7).trim();
    if (rest.startsWith("create ")) {
      return createSkill(rest.slice(7).trim(), workspace);
    }
    return { text: 'Usage: /skill create <name> [--description "..."]' };
  }

  if (trimmed === "/skill") {
    return { text: 'Usage: /skill create <name> [--description "..."]\n       /skills — list discovered skills' };
  }

  return null;
}

function listSkills(workspace: string): CommandResult {
  const skills = discoverSkills(workspace);
  if (skills.length === 0) {
    return { text: "No skills found. Use /skill create <name> to create one." };
  }

  const lines = ["Discovered skills:\n"];
  for (const s of skills) {
    lines.push(`  ${s.name}  [${s.source}]  ${s.description || "(no description)"}`);
    lines.push(`    ${s.path}`);
  }
  return { text: lines.join("\n") };
}

function createSkill(args: string, workspace: string): CommandResult {
  // Parse: <name> [--description "..."]
  let name: string;
  let description: string | undefined;

  const descMatch = args.match(/--description\s+"((?:[^"\\]|\\.)*)"/);
  if (descMatch) {
    description = descMatch[1].replace(/\\"/g, '"');
    name = args.slice(0, descMatch.index).trim();
  } else {
    name = args.split(/\s+/)[0];
  }

  if (!name) {
    return { text: 'Usage: /skill create <name> [--description "..."]' };
  }

  const nameErr = validateSkillName(name);
  if (nameErr) {
    return { text: `Invalid skill name: ${nameErr}` };
  }

  const baseDir = path.join(workspace, ".agents", "skills");

  try {
    const skillDir = scaffoldSkill({ name, description, baseDir });
    return { text: `Skill "${name}" created at ${skillDir}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error: ${msg}` };
  }
}
