import fs from "node:fs";
import path from "node:path";

export interface PluginManifest {
  name: string;
  description?: string;
  version?: string;
  author?: { name: string };
  keywords?: string[];
  skills?: string;
  rules?: string;
  agents?: string;
  mcpServers?: string;
}

/**
 * Generate a plugin manifest by inspecting workspace contents.
 * Only includes paths that have content.
 */
export function generateManifest(opts: {
  name: string;
  description?: string;
  version?: string;
  workspace: string;
}): PluginManifest {
  const manifest: PluginManifest = {
    name: opts.name,
  };

  if (opts.description) manifest.description = opts.description;
  if (opts.version) manifest.version = opts.version;

  // Check for rules
  const rulesDir = path.join(opts.workspace, ".cursor", "rules");
  if (fs.existsSync(rulesDir) && hasFiles(rulesDir)) {
    manifest.rules = "rules/";
  }

  // Check for skills
  const skillsDir = path.join(opts.workspace, ".agents", "skills");
  if (fs.existsSync(skillsDir) && hasFiles(skillsDir)) {
    manifest.skills = "skills/";
  }

  // Check for agents
  const agentsDir = path.join(opts.workspace, ".cursor", "agents");
  if (fs.existsSync(agentsDir) && hasFiles(agentsDir)) {
    manifest.agents = "agents/";
  }

  // Check for MCP config
  const mcpJson = path.join(opts.workspace, ".cursor", "mcp.json");
  if (fs.existsSync(mcpJson)) {
    manifest.mcpServers = ".mcp.json";
  }

  return manifest;
}

function hasFiles(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}
