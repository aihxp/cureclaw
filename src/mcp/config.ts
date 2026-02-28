import fs from "node:fs";
import path from "node:path";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

function mcpJsonPath(workspace: string): string {
  return path.join(workspace, ".cursor", "mcp.json");
}

export function readMcpConfig(workspace: string): McpConfig {
  const filePath = mcpJsonPath(workspace);
  if (!fs.existsSync(filePath)) {
    return { mcpServers: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<McpConfig>;
    return { mcpServers: parsed.mcpServers ?? {} };
  } catch {
    return { mcpServers: {} };
  }
}

export function writeMcpConfig(workspace: string, config: McpConfig): void {
  const filePath = mcpJsonPath(workspace);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function addMcpServer(
  workspace: string,
  name: string,
  server: McpServerConfig,
): void {
  const config = readMcpConfig(workspace);
  if (config.mcpServers[name]) {
    throw new Error(`MCP server "${name}" already exists.`);
  }
  config.mcpServers[name] = server;
  writeMcpConfig(workspace, config);
}

export function removeMcpServer(workspace: string, name: string): boolean {
  const config = readMcpConfig(workspace);
  if (!config.mcpServers[name]) return false;
  delete config.mcpServers[name];
  writeMcpConfig(workspace, config);
  return true;
}

export function listMcpServers(
  workspace: string,
): Array<{ name: string; config: McpServerConfig }> {
  const { mcpServers } = readMcpConfig(workspace);
  return Object.entries(mcpServers).map(([name, config]) => ({ name, config }));
}
