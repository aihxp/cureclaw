import type { CommandContext, CommandResult } from "../scheduler/commands.js";
import { getCloudClient } from "./client.js";
import { steerCloudAgent } from "./steering.js";

/**
 * Handle /cloud subcommands.
 * Returns Promise<CommandResult> for cloud commands, null if not a cloud command.
 */
export function handleCloudCommand(
  input: string,
  _ctx: CommandContext,
): Promise<CommandResult> | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/cloud")) return null;

  const rest = trimmed.slice(6).trim();

  if (rest === "" || rest === "help") {
    return Promise.resolve({
      text: [
        "Cloud commands:",
        '  /cloud launch "prompt" <repo-url> [--model <m>] [--pr]',
        '  /cloud steer "prompt" <repo-url> [--model <m>] [--max <n>]',
        "  /cloud status <id>",
        "  /cloud stop <id>",
        "  /cloud list",
        "  /cloud conversation <id>",
        "  /cloud models",
        "",
        "Requires CURSOR_API_KEY environment variable.",
      ].join("\n"),
    });
  }

  if (rest === "models") return handleModels();
  if (rest === "list") return handleList();
  if (rest === "status" || rest.startsWith("status ")) return handleStatus(rest.slice(7).trim());
  if (rest === "stop" || rest.startsWith("stop ")) return handleStop(rest.slice(5).trim());
  if (rest === "conversation" || rest.startsWith("conversation ")) return handleConversation(rest.slice(13).trim());
  if (rest.startsWith("steer ")) return handleSteer(rest.slice(6).trim());
  if (rest.startsWith("launch ")) return handleLaunch(rest.slice(7).trim());

  return Promise.resolve({
    text: `Unknown cloud subcommand. Type /cloud help for usage.`,
  });
}

async function handleModels(): Promise<CommandResult> {
  const client = getCloudClient();
  if (!client) return noApiKey();

  try {
    const { models } = await client.listModels();
    if (models.length === 0) return { text: "No models available." };
    return { text: "Available models:\n" + models.map((m) => `  ${m}`).join("\n") };
  } catch (err) {
    return { text: `Error: ${errorMessage(err)}` };
  }
}

async function handleList(): Promise<CommandResult> {
  const client = getCloudClient();
  if (!client) return noApiKey();

  try {
    const { agents } = await client.listAgents({ limit: 20 });
    if (agents.length === 0) return { text: "No cloud agents." };

    const lines = ["Cloud agents:\n"];
    for (const a of agents) {
      lines.push(`  ${a.id}  [${a.status}]  ${a.name || "(unnamed)"}`);
      if (a.summary) {
        lines.push(`         ${a.summary.slice(0, 80)}`);
      }
    }
    return { text: lines.join("\n") };
  } catch (err) {
    return { text: `Error: ${errorMessage(err)}` };
  }
}

async function handleStatus(id: string): Promise<CommandResult> {
  if (!id) return { text: "Usage: /cloud status <id>" };
  const client = getCloudClient();
  if (!client) return noApiKey();

  try {
    const agent = await client.getAgent(id);
    const lines = [
      `Agent: ${agent.id}`,
      `Name: ${agent.name || "(unnamed)"}`,
      `Status: ${agent.status}`,
      `Created: ${agent.createdAt}`,
    ];
    if (agent.source.repository) lines.push(`Repo: ${agent.source.repository}`);
    if (agent.summary) lines.push(`Summary: ${agent.summary}`);
    return { text: lines.join("\n") };
  } catch (err) {
    return { text: `Error: ${errorMessage(err)}` };
  }
}

async function handleStop(id: string): Promise<CommandResult> {
  if (!id) return { text: "Usage: /cloud stop <id>" };
  const client = getCloudClient();
  if (!client) return noApiKey();

  try {
    await client.stopAgent(id);
    return { text: `Agent ${id} stopped.` };
  } catch (err) {
    return { text: `Error: ${errorMessage(err)}` };
  }
}

async function handleConversation(id: string): Promise<CommandResult> {
  if (!id) return { text: "Usage: /cloud conversation <id>" };
  const client = getCloudClient();
  if (!client) return noApiKey();

  try {
    const { messages } = await client.getConversation(id);
    if (messages.length === 0) return { text: "No messages yet." };

    const lines = messages.map((m) => {
      const role = m.type === "user_message" ? "User" : "Assistant";
      return `[${role}] ${m.text}`;
    });
    return { text: lines.join("\n\n") };
  } catch (err) {
    return { text: `Error: ${errorMessage(err)}` };
  }
}

async function handleLaunch(args: string): Promise<CommandResult> {
  // Parse: "prompt" <repo-url> [--model <m>] [--pr]
  const match = args.match(/^"((?:[^"\\]|\\.)*)"\s+(\S+)(.*)$/);
  if (!match) {
    return {
      text: 'Usage: /cloud launch "prompt" <repo-url> [--model <model>] [--pr]',
    };
  }

  const prompt = match[1].replace(/\\"/g, '"');
  const repoUrl = match[2];
  const flags = match[3].trim();

  let model: string | undefined;
  let autoCreatePr = false;

  const modelMatch = flags.match(/--model\s+(\S+)/);
  if (modelMatch) model = modelMatch[1];
  if (flags.includes("--pr")) autoCreatePr = true;

  const client = getCloudClient();
  if (!client) return noApiKey();

  try {
    const agent = await client.launchAgent({
      prompt: { text: prompt },
      model,
      source: { repository: repoUrl },
      target: autoCreatePr ? { autoCreatePr: true } : undefined,
    });
    return {
      text: `Agent launched.\nID: ${agent.id}\nStatus: ${agent.status}\nRepo: ${repoUrl}`,
    };
  } catch (err) {
    return { text: `Error: ${errorMessage(err)}` };
  }
}

async function handleSteer(args: string): Promise<CommandResult> {
  // Parse: "prompt" <repo-url> [--model <m>] [--max <n>]
  const match = args.match(/^"((?:[^"\\]|\\.)*)"\s+(\S+)(.*)$/);
  if (!match) {
    return {
      text: 'Usage: /cloud steer "prompt" <repo-url> [--model <model>] [--max <n>]',
    };
  }

  const prompt = match[1].replace(/\\"/g, '"');
  const repoUrl = match[2];
  const flags = match[3].trim();

  let model: string | undefined;
  let maxFollowups = 5;

  const modelMatch = flags.match(/--model\s+(\S+)/);
  if (modelMatch) model = modelMatch[1];
  const maxMatch = flags.match(/--max\s+(\d+)/);
  if (maxMatch) maxFollowups = parseInt(maxMatch[1], 10);

  const client = getCloudClient();
  if (!client) return noApiKey();

  const lines: string[] = [];

  try {
    for await (const event of steerCloudAgent({
      client,
      request: {
        prompt: { text: prompt },
        model,
        source: { repository: repoUrl },
      },
      maxFollowups,
    })) {
      switch (event.type) {
        case "launch":
          lines.push(`Agent launched: ${event.agentId}`);
          break;
        case "followup":
          lines.push(`Follow-up #${event.followupNumber}: ${event.result}`);
          break;
        case "done":
          lines.push(`Done. Result: ${(event.result ?? "").slice(0, 500)}`);
          break;
        case "error":
          lines.push(`Error: ${event.error}`);
          break;
      }
    }
  } catch (err) {
    lines.push(`Error: ${errorMessage(err)}`);
  }

  return { text: lines.join("\n") };
}

function noApiKey(): CommandResult {
  return {
    text: "No CURSOR_API_KEY set. Export CURSOR_API_KEY to use cloud commands.",
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
