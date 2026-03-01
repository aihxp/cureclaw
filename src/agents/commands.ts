import path from "node:path";
import fs from "node:fs";
import type { CommandResult } from "../scheduler/commands.js";
import type { CursorAgentConfig } from "../types.js";
import type { BackgroundRunner } from "../background/runner.js";
import { scaffoldAgent, validateAgentName } from "./scaffold.js";
import { discoverAgents } from "./list.js";

/** Track live subagents started via /agent run. */
interface LiveSubagent {
  agent: { abort: () => void; queueFollowUp: (text: string) => void; state: { isStreaming: boolean; messageText: string } };
  runId: string;
  name: string;
  sessionKey: string;
  startedAt: string;
}

const liveSubagents = new Map<string, LiveSubagent>();

/**
 * Handle /agents and /agent commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleAgentCommand(
  input: string,
  workspace: string,
  _backgroundRunner?: BackgroundRunner,
  cursorConfig?: CursorAgentConfig,
): CommandResult | null | Promise<CommandResult> {
  const trimmed = input.trim();

  if (trimmed === "/agents") {
    return listAgents(workspace);
  }

  if (trimmed.startsWith("/agent ")) {
    const rest = trimmed.slice(7).trim();

    if (rest.startsWith("create ")) {
      return createAgent(rest.slice(7).trim(), workspace);
    }

    if (rest === "run") {
      return { text: "Usage: /agent run <name> [prompt]" };
    }

    if (rest.startsWith("run ")) {
      return runAgent(rest.slice(4).trim(), workspace, cursorConfig);
    }

    if (rest === "steer") {
      return { text: 'Usage: /agent steer <session-prefix> "follow-up message"' };
    }

    if (rest.startsWith("steer ")) {
      return steerAgent(rest.slice(6).trim());
    }

    if (rest === "kill") {
      return { text: "Usage: /agent kill <session-prefix>" };
    }

    if (rest.startsWith("kill ")) {
      return killAgent(rest.slice(5).trim());
    }

    if (rest === "list --active") {
      return listActiveAgents();
    }

    return { text: agentHelp() };
  }

  if (trimmed === "/agent") {
    return { text: agentHelp() };
  }

  return null;
}

function listAgents(workspace: string): CommandResult {
  const agents = discoverAgents(workspace);
  if (agents.length === 0) {
    return { text: "No subagents found. Use /agent create <name> to create one." };
  }

  const lines = ["Discovered subagents:\n"];
  for (const a of agents) {
    const flags = [
      a.readonly ? "readonly" : null,
      a.isBackground ? "background" : null,
      a.model && a.model !== "inherit" ? `model:${a.model}` : null,
    ].filter(Boolean).join(", ");
    const flagStr = flags ? `  (${flags})` : "";
    lines.push(`  ${a.slug}  [${a.source}]  ${a.description || "(no description)"}${flagStr}`);
    lines.push(`    ${a.path}`);
  }
  return { text: lines.join("\n") };
}

function createAgent(args: string, workspace: string): CommandResult {
  // Parse: <name> [--model <m>] [--readonly] [--description "..."]
  let name: string;
  let description: string | undefined;
  let model: string | undefined;
  let readonly = false;

  // Extract --description "..."
  const descMatch = args.match(/--description\s+"((?:[^"\\]|\\.)*)"/);
  if (descMatch) {
    description = descMatch[1].replace(/\\"/g, '"');
    args = args.replace(descMatch[0], "").trim();
  }

  // Extract --model <m>
  const modelMatch = args.match(/--model\s+(\S+)/);
  if (modelMatch) {
    model = modelMatch[1];
    args = args.replace(modelMatch[0], "").trim();
  }

  // Extract --readonly
  if (args.includes("--readonly")) {
    readonly = true;
    args = args.replace(/--readonly/, "").trim();
  }

  name = args.split(/\s+/)[0];

  if (!name) {
    return { text: 'Usage: /agent create <name> [--model <m>] [--readonly] [--description "..."]' };
  }

  const nameErr = validateAgentName(name);
  if (nameErr) {
    return { text: `Invalid agent name: ${nameErr}` };
  }

  const baseDir = path.join(workspace, ".cursor", "agents");

  try {
    const filePath = scaffoldAgent({ name, description, model, readonly, baseDir });
    return { text: `Subagent "${name}" created at ${filePath}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error: ${msg}` };
  }
}

async function runAgent(
  args: string,
  workspace: string,
  cursorConfig?: CursorAgentConfig,
): Promise<CommandResult> {
  // Parse: <name> [prompt]
  const parts = args.match(/^(\S+)(?:\s+(.+))?$/s);
  if (!parts) {
    return { text: "Usage: /agent run <name> [prompt]" };
  }

  const name = parts[1];
  const promptText = parts[2]?.trim();

  // Discover the agent
  const agents = discoverAgents(workspace);
  const agentInfo = agents.find((a) => a.slug === name);
  if (!agentInfo) {
    return { text: `Subagent "${name}" not found. Use /agents to list available subagents.` };
  }

  if (!cursorConfig) {
    return { text: "Cannot run subagent: cursor configuration not available." };
  }

  // Read the agent instructions
  let instructions = "";
  try {
    instructions = fs.readFileSync(agentInfo.path, "utf-8");
    // Strip frontmatter
    instructions = instructions.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
  } catch {
    // Use name as fallback
  }

  const prompt = promptText || instructions || `Run the ${name} subagent.`;
  const timestamp = Date.now();
  const sessionKey = `subagent:${name}:${timestamp}`;

  try {
    // Dynamic imports to avoid circular deps
    const { Agent } = await import("../agent.js");
    const { startRun, completeRun } = await import("../fleet/registry.js");

    const agentConfig: CursorAgentConfig = {
      ...cursorConfig,
      mode: agentInfo.readonly ? "ask" : cursorConfig.mode,
    };

    const agent = new Agent(agentConfig, {
      useDb: true,
      sessionKey,
    });

    const run = startRun({
      kind: "subagent",
      label: `subagent:${name} — ${prompt.slice(0, 50)}`,
    });

    liveSubagents.set(sessionKey, {
      agent,
      runId: run.id,
      name,
      sessionKey,
      startedAt: new Date().toISOString(),
    });

    // Run in background (don't await)
    agent.prompt(prompt).then(() => {
      completeRun(run.id, {
        status: "success",
        result: agent.state.messageText?.slice(0, 500),
      });
      liveSubagents.delete(sessionKey);
    }).catch((err) => {
      completeRun(run.id, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      liveSubagents.delete(sessionKey);
    });

    return { text: `Subagent "${name}" started (run: ${run.id}, session: ${sessionKey})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error starting subagent: ${msg}` };
  }
}

function steerAgent(args: string): CommandResult {
  // Parse: <session-prefix> "follow-up"
  const match = args.match(/^(\S+)\s+(.+)$/s);
  if (!match) {
    return { text: 'Usage: /agent steer <session-prefix> "follow-up message"' };
  }

  const prefix = match[1];
  let followUp = match[2].trim();

  // Strip surrounding quotes
  if ((followUp.startsWith('"') && followUp.endsWith('"')) || (followUp.startsWith("'") && followUp.endsWith("'"))) {
    followUp = followUp.slice(1, -1);
  }

  const entry = findLiveAgent(prefix);
  if (!entry) {
    return { text: `No active subagent matching "${prefix}". Use /agent list --active to see running subagents.` };
  }

  entry.agent.queueFollowUp(followUp);
  return { text: `Follow-up queued for subagent "${entry.name}".` };
}

function killAgent(prefix: string): CommandResult {
  const entry = findLiveAgent(prefix.trim());
  if (!entry) {
    return { text: `No active subagent matching "${prefix}". Use /agent list --active to see running subagents.` };
  }

  entry.agent.abort();
  liveSubagents.delete(entry.sessionKey);

  // Complete the run
  import("../fleet/registry.js").then(({ completeRun }) => {
    completeRun(entry.runId, { status: "stopped" });
  }).catch(() => {});

  return { text: `Subagent "${entry.name}" killed (run: ${entry.runId}).` };
}

function listActiveAgents(): CommandResult {
  if (liveSubagents.size === 0) {
    return { text: "No active subagents." };
  }

  const lines = ["Active subagents:\n"];
  for (const [key, entry] of liveSubagents) {
    const streaming = entry.agent.state.isStreaming ? "streaming" : "idle";
    lines.push(`  ${entry.name}  [${streaming}]  run:${entry.runId}  started:${entry.startedAt}`);
    lines.push(`    session: ${key}`);
  }
  return { text: lines.join("\n") };
}

function findLiveAgent(prefix: string): LiveSubagent | undefined {
  // Exact match first
  if (liveSubagents.has(prefix)) return liveSubagents.get(prefix);

  // Prefix match on session key or name
  for (const [key, entry] of liveSubagents) {
    if (key.startsWith(prefix) || entry.name === prefix || entry.runId.startsWith(prefix)) {
      return entry;
    }
  }
  return undefined;
}

function agentHelp(): string {
  return [
    "Agent commands:",
    "",
    '  /agent create <name> [--model <m>] [--readonly] [--description "..."]',
    "  /agent run <name> [prompt]       Run a subagent (background)",
    '  /agent steer <prefix> "message"  Send follow-up to running subagent',
    "  /agent kill <prefix>             Stop a running subagent",
    "  /agent list --active             Show running subagents",
    "  /agents                          List discovered subagents",
  ].join("\n");
}
