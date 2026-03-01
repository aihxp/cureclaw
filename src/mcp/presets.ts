import type { McpPreset } from "../types.js";

/** Curated registry of community MCP servers. */
export const PRESETS: McpPreset[] = [
  {
    name: "filesystem",
    description: "Read/write local files and directories",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    envVars: [],
    category: "dev-tools",
  },
  {
    name: "github",
    description: "GitHub API: repos, issues, PRs, actions",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envVars: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    category: "dev-tools",
  },
  {
    name: "slack",
    description: "Slack API: channels, messages, reactions",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envVars: ["SLACK_BOT_TOKEN"],
    category: "communication",
  },
  {
    name: "postgres",
    description: "PostgreSQL database queries",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    envVars: ["POSTGRES_CONNECTION_STRING"],
    category: "dev-tools",
  },
  {
    name: "sqlite",
    description: "SQLite database queries",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    envVars: [],
    category: "dev-tools",
  },
  {
    name: "brave-search",
    description: "Web search via Brave Search API",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envVars: ["BRAVE_API_KEY"],
    category: "productivity",
  },
  {
    name: "fetch",
    description: "Fetch and convert web pages to markdown",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    envVars: [],
    category: "productivity",
  },
  {
    name: "memory",
    description: "Persistent memory via knowledge graph",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    envVars: [],
    category: "productivity",
  },
  {
    name: "puppeteer",
    description: "Browser automation and screenshots",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    envVars: [],
    category: "dev-tools",
  },
  {
    name: "google-maps",
    description: "Google Maps: directions, places, geocoding",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    envVars: ["GOOGLE_MAPS_API_KEY"],
    category: "productivity",
  },
];

/** Find a preset by name (case-insensitive). */
export function findPreset(name: string): McpPreset | undefined {
  const lower = name.toLowerCase();
  return PRESETS.find((p) => p.name.toLowerCase() === lower);
}

/** List all presets, optionally filtered by category. */
export function listPresets(category?: string): McpPreset[] {
  if (!category) return PRESETS;
  const lower = category.toLowerCase();
  return PRESETS.filter((p) => p.category.toLowerCase() === lower);
}

/** Get all unique categories. */
export function getCategories(): string[] {
  return [...new Set(PRESETS.map((p) => p.category))];
}

/** Format presets for display. */
export function formatPresetList(presets: McpPreset[]): string {
  if (presets.length === 0) return "No presets found.";

  const lines = ["MCP Presets:\n"];
  let currentCategory = "";
  const sorted = [...presets].sort((a, b) => a.category.localeCompare(b.category));

  for (const p of sorted) {
    if (p.category !== currentCategory) {
      currentCategory = p.category;
      lines.push(`  [${currentCategory}]`);
    }
    const envNote = p.envVars.length > 0 ? ` (needs: ${p.envVars.join(", ")})` : "";
    lines.push(`    ${p.name} — ${p.description}${envNote}`);
  }

  lines.push("\nUse /mcp install <name> to install a preset.");
  return lines.join("\n");
}

/** Check if required env vars are set for a preset. */
export function checkPresetEnv(preset: McpPreset): { ready: boolean; missing: string[] } {
  const missing = preset.envVars.filter((v) => !process.env[v]);
  return { ready: missing.length === 0, missing };
}
