import fs from "node:fs";
import path from "node:path";
import { generateManifest, type PluginManifest } from "./manifest.js";

export interface BuildResult {
  outputDir: string;
  manifest: PluginManifest;
  copiedFiles: string[];
}

/**
 * Build a distributable plugin from workspace artifacts.
 */
export function buildPlugin(opts: {
  workspace: string;
  outputDir: string;
  name: string;
  description?: string;
  version?: string;
}): BuildResult {
  const copiedFiles: string[] = [];

  // Create output structure
  const pluginMetaDir = path.join(opts.outputDir, ".cursor-plugin");
  fs.mkdirSync(pluginMetaDir, { recursive: true });

  // 1. Copy .cursor/rules/ → outputDir/rules/
  const rulesDir = path.join(opts.workspace, ".cursor", "rules");
  if (fs.existsSync(rulesDir)) {
    const dest = path.join(opts.outputDir, "rules");
    copyDirRecursive(rulesDir, dest, copiedFiles);
  }

  // 2. Copy .agents/skills/ → outputDir/skills/
  const skillsDir = path.join(opts.workspace, ".agents", "skills");
  if (fs.existsSync(skillsDir)) {
    const dest = path.join(opts.outputDir, "skills");
    copyDirRecursive(skillsDir, dest, copiedFiles);
  }

  // 3. Copy .cursor/agents/ → outputDir/agents/
  const agentsDir = path.join(opts.workspace, ".cursor", "agents");
  if (fs.existsSync(agentsDir)) {
    const dest = path.join(opts.outputDir, "agents");
    copyDirRecursive(agentsDir, dest, copiedFiles);
  }

  // 4. Copy and sanitize .cursor/mcp.json → outputDir/.mcp.json
  const mcpJson = path.join(opts.workspace, ".cursor", "mcp.json");
  if (fs.existsSync(mcpJson)) {
    const dest = path.join(opts.outputDir, ".mcp.json");
    const raw = fs.readFileSync(mcpJson, "utf-8");
    const sanitized = sanitizeMcpConfig(raw);
    fs.writeFileSync(dest, sanitized, "utf-8");
    copiedFiles.push(".mcp.json");
  }

  // 5. Generate and write manifest
  const manifest = generateManifest({
    name: opts.name,
    description: opts.description,
    version: opts.version,
    workspace: opts.workspace,
  });

  fs.writeFileSync(
    path.join(pluginMetaDir, "plugin.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );
  copiedFiles.push(".cursor-plugin/plugin.json");

  return { outputDir: opts.outputDir, manifest, copiedFiles };
}

/**
 * Recursively copy a directory, tracking copied files.
 */
function copyDirRecursive(
  src: string,
  dest: string,
  copiedFiles: string[],
  relBase?: string,
): void {
  fs.mkdirSync(dest, { recursive: true });
  const base = relBase ?? path.basename(dest);

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = `${base}/${entry.name}`;

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, copiedFiles, relPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      copiedFiles.push(relPath);
    }
  }
}

/**
 * Sanitize MCP config by replacing env var values that look like secrets.
 * Keys containing KEY, TOKEN, SECRET, or PASSWORD get replaced with placeholders.
 */
export function sanitizeMcpConfig(raw: string): string {
  try {
    const config = JSON.parse(raw);
    if (config.mcpServers) {
      for (const server of Object.values(config.mcpServers) as Array<{
        env?: Record<string, string>;
      }>) {
        if (server.env) {
          for (const [key, _value] of Object.entries(server.env)) {
            if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key)) {
              server.env[key] = `YOUR_${key}_HERE`;
            }
          }
        }
      }
    }
    return JSON.stringify(config, null, 2) + "\n";
  } catch {
    return raw;
  }
}
