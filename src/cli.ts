import path from "node:path";
import os from "node:os";
import * as readline from "node:readline";
import { Agent } from "./agent.js";
import { handleAgentCommand } from "./agents/commands.js";
import { handleCloudCommand } from "./cloud/commands.js";
import { handleFleetCommand } from "./fleet/commands.js";
import { handleCommandsCommand } from "./commands/commands.js";
import { getSession, getAllSessions, getHistory } from "./db.js";
import { handleHooksCommand } from "./hooks/commands.js";
import { handleMcpCommand } from "./mcp/commands.js";
import { isValidMode, parseModePrefix } from "./mode.js";
import { handlePluginCommand } from "./plugin/commands.js";
import { handleSchedulerCommand, handlePipelineCommand } from "./scheduler/commands.js";
import { handleSkillCommand } from "./skills/commands.js";
import { handleTriggerCommand } from "./trigger/commands.js";
import { handleWorkstationCommand, testWorkstationConnectivity } from "./workstation-commands.js";
import { handleMemoryCommand } from "./memory/commands.js";
import { handleApprovalCommand } from "./approval/commands.js";
import { handleBackgroundCommand } from "./background/commands.js";
import { handleWorkflowCommand } from "./workflow/commands.js";
import { handleIdentityCommand } from "./identity/commands.js";
import { handleNotifyCommand } from "./notifications/commands.js";
import type { BackgroundRunner } from "./background/runner.js";
import type { AgentEvent, CursorAgentConfig } from "./types.js";

// ANSI helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function startCli(config: CursorAgentConfig, backgroundRunner?: BackgroundRunner): Promise<void> {
  const agent = new Agent(config, { useDb: true });
  const cwd = path.resolve(config.cwd || process.cwd());

  const workspace =
    process.env.CURECLAW_WORKSPACE ??
    path.join(os.homedir(), ".cureclaw", "workspace");

  // Session banner
  const saved = getSession(cwd);
  if (saved) {
    console.log(
      bold("CureClaw v1.1") + dim(` (cursor ${config.model ?? "auto"})`),
    );
    console.log(
      dim(
        `Resuming session ${saved.session_id.slice(0, 8)}... (${formatTimeAgo(saved.updated_at)})`,
      ),
    );
  } else {
    console.log(
      bold("CureClaw v1.1") + dim(` (cursor ${config.model ?? "auto"})`),
    );
    console.log(dim("New session"));
  }
  console.log(dim("Type /help for commands. Ctrl+C to exit.\n"));

  agent.subscribe(renderEvent);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: cyan("> "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Queue while streaming
    if (agent.state.isStreaming) {
      agent.queueFollowUp(trimmed);
      console.log(dim(`[queued] (${agent.queuedCount} pending)`));
      return;
    }

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      await handleCommand(trimmed, agent, cwd, workspace, config, backgroundRunner);
      rl.prompt();
      return;
    }

    // Mode prefix: ?question → ask mode, !instruction → plan mode
    const modeOverride = parseModePrefix(trimmed);
    if (modeOverride) {
      try {
        await agent.prompt(modeOverride.prompt, { mode: modeOverride.mode });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(red(`Error: ${msg}`));
      }
      console.log();
      rl.prompt();
      return;
    }

    // @workstation prefix: run prompt on a specific workstation
    let targetWorkstation: string | undefined;
    let promptText = trimmed;
    if (trimmed.startsWith("@")) {
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx > 1) {
        targetWorkstation = trimmed.slice(1, spaceIdx);
        promptText = trimmed.slice(spaceIdx + 1).trim();
      }
    }

    try {
      if (targetWorkstation) {
        const wsAgent = new Agent(
          { ...config, workstation: targetWorkstation },
          { useDb: true },
        );
        wsAgent.subscribe(renderEvent);
        await wsAgent.prompt(promptText);
      } else {
        await agent.prompt(promptText);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`Error: ${msg}`));
    }

    console.log();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(dim("\nGoodbye."));
    process.exit(0);
  });

  // Ctrl+C: abort if streaming, exit otherwise
  process.on("SIGINT", () => {
    if (agent.state.isStreaming) {
      agent.abort();
    } else {
      rl.close();
    }
  });
}

async function handleCommand(cmd: string, agent: Agent, cwd: string, workspace: string, config?: CursorAgentConfig, backgroundRunner?: BackgroundRunner): Promise<void> {
  const ctx = { channelType: "cli", channelId: "cli" };

  // 0a. Workstation commands
  const wsResult = handleWorkstationCommand(cmd);
  if (wsResult) {
    console.log(wsResult.text);
    // If it was a status test, run the async connectivity check
    if (cmd.startsWith("/workstation status ")) {
      const name = cmd.slice(20).trim();
      const check = await testWorkstationConnectivity(name);
      if (check.ok) {
        console.log(green(`Connected. ${check.output}`));
      } else {
        console.log(red(`Failed: ${check.output}`));
      }
    }
    return;
  }

  // 0b. Pipeline command
  if (cmd.startsWith("/pipeline")) {
    const result = handlePipelineCommand(cmd, ctx);
    if (result?.pipeline) {
      try {
        await agent.runPipeline(result.pipeline);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(red(`Error: ${msg}`));
      }
      console.log();
      return;
    }
    if (result) console.log(result.text);
    return;
  }

  // 1. Scheduler commands (sync)
  const schedResult = handleSchedulerCommand(cmd, ctx);
  if (schedResult) {
    console.log(schedResult.text);
    return;
  }

  // 1a. Trigger commands (sync)
  const triggerResult = handleTriggerCommand(cmd, ctx);
  if (triggerResult) {
    console.log(triggerResult.text);
    return;
  }

  // 1b. Fleet/orchestrate/runs commands (sync or async)
  const fleetResult = handleFleetCommand(cmd, ctx, config);
  if (fleetResult) {
    const result = await fleetResult;
    console.log(result.text);
    return;
  }

  // 1c. Memory commands
  const memResult = handleMemoryCommand(cmd);
  if (memResult) {
    console.log(memResult.text);
    return;
  }

  // 1d. Approval commands
  const approvalResult = handleApprovalCommand(cmd, ctx);
  if (approvalResult) {
    console.log(approvalResult.text);
    return;
  }

  // 1e. Background commands
  const bgResult = handleBackgroundCommand(cmd, backgroundRunner);
  if (bgResult) {
    console.log(bgResult.text);
    return;
  }

  // 1f. Workflow commands (sync or async)
  const wfResult = handleWorkflowCommand(cmd, ctx, config);
  if (wfResult) {
    const result = await wfResult;
    console.log(result.text);
    return;
  }

  // 2. Cloud commands (async)
  const cloudResult = handleCloudCommand(cmd, ctx);
  if (cloudResult) {
    const result = await cloudResult;
    console.log(result.text);
    return;
  }

  // 3. Skill commands (sync)
  const skillResult = handleSkillCommand(cmd, workspace);
  if (skillResult) {
    console.log(skillResult.text);
    return;
  }

  // 4. MCP commands (sync)
  const mcpResult = handleMcpCommand(cmd, workspace);
  if (mcpResult) {
    console.log(mcpResult.text);
    return;
  }

  // 4a. Hooks commands (sync)
  const hooksResult = handleHooksCommand(cmd, workspace);
  if (hooksResult) {
    console.log(hooksResult.text);
    return;
  }

  // 4b. Identity commands (sync)
  const identityResult = handleIdentityCommand(cmd);
  if (identityResult) {
    console.log(identityResult.text);
    return;
  }

  // 4c. Notification commands (sync or async)
  const notifyResult = handleNotifyCommand(cmd);
  if (notifyResult) {
    if (notifyResult instanceof Promise || (notifyResult && "then" in notifyResult)) {
      const resolved = await notifyResult;
      console.log(resolved.text);
    } else {
      console.log((notifyResult as { text: string }).text);
    }
    return;
  }

  // 4d. Agent commands (sync or async)
  const agentResult = handleAgentCommand(cmd, workspace, backgroundRunner, config);
  if (agentResult) {
    if (agentResult instanceof Promise || (agentResult && "then" in agentResult)) {
      const resolved = await agentResult;
      console.log(resolved.text);
    } else {
      console.log((agentResult as { text: string }).text);
    }
    return;
  }

  // 4c. Commands discovery + /run (sync, but may trigger prompt)
  const cmdResult = handleCommandsCommand(cmd, workspace);
  if (cmdResult) {
    if (cmdResult.runPrompt) {
      console.log(cmdResult.text);
      try {
        await agent.prompt(cmdResult.runPrompt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(red(`Error: ${msg}`));
      }
      console.log();
    } else {
      console.log(cmdResult.text);
    }
    return;
  }

  // 5. Plugin commands (sync)
  const pluginResult = handlePluginCommand(cmd, workspace);
  if (pluginResult) {
    console.log(pluginResult.text);
    return;
  }

  // 6. Mode command
  if (cmd === "/mode" || cmd.startsWith("/mode ")) {
    const modeArg = cmd.slice(5).trim();
    if (!modeArg) {
      console.log(`Current mode: ${bold(agent.state.mode)}`);
      console.log(dim("Usage: /mode <agent|plan|ask>"));
    } else if (isValidMode(modeArg)) {
      agent.setMode(modeArg);
      console.log(green(`Mode set to: ${modeArg}`));
    } else {
      console.log(red(`Invalid mode: "${modeArg}". Valid modes: agent, plan, ask`));
    }
    return;
  }

  // 7. Built-in commands
  switch (cmd) {
    case "/new": {
      agent.newSession();
      console.log(green("Session cleared. Next prompt starts fresh."));
      break;
    }

    case "/sessions": {
      const sessions = getAllSessions();
      if (sessions.length === 0) {
        console.log(dim("No saved sessions."));
        break;
      }
      console.log(bold("Saved sessions:\n"));
      for (const s of sessions) {
        const marker = s.cwd === cwd ? cyan(" ←") : "";
        console.log(
          `  ${s.session_id.slice(0, 8)}  ${dim(formatTimeAgo(s.updated_at))}  ${s.cwd}${marker}`,
        );
        if (s.last_prompt) {
          console.log(dim(`    "${s.last_prompt.slice(0, 60)}"`));
        }
      }
      console.log();
      break;
    }

    case "/history": {
      const entries = getHistory(cwd, 10);
      if (entries.length === 0) {
        console.log(dim("No history for this directory."));
        break;
      }
      console.log(bold("Recent prompts:\n"));
      for (const h of entries) {
        const tokens = h.input_tokens && h.output_tokens
          ? dim(` [${h.input_tokens}in/${h.output_tokens}out]`)
          : "";
        const dur = h.duration_ms ? dim(` ${h.duration_ms}ms`) : "";
        console.log(
          `  ${dim(formatTimeAgo(h.created_at))} ${h.prompt.slice(0, 70)}${tokens}${dur}`,
        );
      }
      console.log();
      break;
    }

    case "/help": {
      console.log(bold("Commands:\n"));
      console.log("  /new           Clear session, start fresh");
      console.log("  /mode          Set agent mode: /mode <agent|plan|ask>");
      console.log("  /sessions      List all saved sessions");
      console.log("  /history       Show recent prompts for this directory");
      console.log('  /schedule      Schedule a job: /schedule "prompt" <schedule> [--cloud] [--reflect] [--workstation <name>] [--mode <m>]');
      console.log("  /jobs          List all scheduled jobs");
      console.log("  /cancel        Cancel a job: /cancel <id-prefix>");
      console.log("  /trigger       Trigger commands (add, list, remove, enable, disable, info)");
      console.log('  /pipeline      Run multi-step pipeline: /pipeline "step1" [--reflect] "step2"');
      console.log("  /cloud         Cloud agent commands (launch, steer, status, stop, list, conversation, models)");
      console.log("  /fleet         Fleet commands (launch, status, stop, list) — parallel cloud agents");
      console.log('  /orchestrate   Decompose a goal and dispatch workers: /orchestrate "goal" [--cloud --repo <url>]');
      console.log("  /runs          List agent runs: /runs [--active]");
      console.log("  /run info      Show run details: /run info <id-prefix>");
      console.log("  /remember      Store a memory: /remember <key> <content> [--tags t1,t2]");
      console.log("  /recall        Search memories: /recall [query]");
      console.log("  /forget        Remove a memory: /forget <key>");
      console.log("  /background    Background agent commands (register, unregister, list, suggest, status)");
      console.log("  /approval      Approval gate commands (add, list, remove, enable, disable)");
      console.log("  /workflow      Workflow commands (create, run, status, list, stop, remove)");
      console.log("  /workstation   Workstation commands (list, add, remove, default, status)");
      console.log("  /hooks         Hook commands (list, add, remove)");
      console.log("  /identity      Identity commands (set, show, list, remove)");
      console.log("  /notify        Send notifications: /notify <channel:id> \"message\"");
      console.log("  /agents        List discovered subagents");
      console.log("  /agent create  Create a subagent: /agent create <name> [--readonly] [--model <m>]");
      console.log("  /agent run     Run a subagent: /agent run <name> [prompt]");
      console.log("  /agent steer   Send follow-up: /agent steer <prefix> \"message\"");
      console.log("  /agent kill    Stop a subagent: /agent kill <prefix>");
      console.log("  /commands      List discovered custom commands");
      console.log("  /run           Run a custom command: /run <name> [context]");
      console.log("  /skill create  Create a new skill: /skill create <name>");
      console.log("  /skills        List discovered skills");
      console.log("  /mcp           MCP server commands (list, add, remove, presets, install)");
      console.log("  /plugin        Plugin commands (build, info)");
      console.log("  /help          Show this help");
      console.log("  /quit          Exit CureClaw");
      console.log();
      console.log(dim("Tip: Type while agent is streaming to queue follow-up prompts."));
      console.log(dim("Tip: Use @name before a prompt to target a workstation (e.g., @dev explain this)."));
      console.log(dim("Tip: Prefix with ? for ask mode or ! for plan mode (e.g., ?what does this do)."));
      console.log();
      break;
    }

    case "/quit":
    case "/exit":
      process.exit(0);

    default:
      console.log(dim(`Unknown command: ${cmd}. Type /help for commands.`));
  }
}

function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case "agent_start":
      process.stdout.write(
        dim(
          `[session: ${event.sessionId.slice(0, 8)}... model: ${event.model}]\n`,
        ),
      );
      break;

    case "thinking_delta":
      process.stdout.write(dim(event.text));
      break;

    case "thinking_end":
      process.stdout.write("\n");
      break;

    case "message_delta":
      process.stdout.write(event.text);
      break;

    case "message_end":
      if (!event.text.endsWith("\n")) {
        process.stdout.write("\n");
      }
      break;

    case "tool_start": {
      console.log(yellow(`\n[tool: ${event.toolName}] ${event.description}`));
      const cmd = event.args.command;
      if (typeof cmd === "string") {
        console.log(dim(`  $ ${cmd}`));
      }
      break;
    }

    case "tool_end": {
      const status = event.success ? green("ok") : red("failed");
      console.log(yellow(`[tool: ${event.toolName}] ${status}`));
      if (event.result && event.result.length < 500) {
        console.log(dim(event.result));
      }
      break;
    }

    case "agent_end":
      console.log(
        dim(
          `\n[done in ${event.durationMs}ms | tokens: ${event.usage.inputTokens}in/${event.usage.outputTokens}out]`,
        ),
      );
      break;

    case "error":
      console.error(red(`[error] ${event.message}`));
      break;

    case "followup_start":
      console.log(dim(`\n[followup] "${event.prompt.slice(0, 60)}"`));
      break;

    case "reflection_start":
      console.log(dim("\n[reflecting] Reviewing output..."));
      break;

    case "reflection_end":
      console.log(dim(`[reflection] ${event.passed ? "LGTM" : "Issues found and addressed"}`));
      break;

    case "pipeline_start":
      console.log(dim(`\n[pipeline] ${event.stepCount} steps`));
      break;

    case "step_start":
      console.log(dim(`\n[step ${event.stepIndex + 1}] ${event.prompt.slice(0, 60)}`));
      break;

    case "step_end":
      break;

    case "pipeline_end":
      console.log(dim("[pipeline] Complete"));
      break;

    case "cloud_steer_start":
      console.log(dim(`\n[cloud steer] Agent ${event.agentId} launched`));
      break;

    case "cloud_steer_followup":
      console.log(dim(`[cloud steer] Follow-up #${event.followupNumber}: ${event.prompt.slice(0, 60)}`));
      break;

    case "cloud_steer_end":
      console.log(dim(`[cloud steer] Done (${event.totalFollowups} follow-ups)`));
      break;
  }
}
