import type { CommandResult } from "../scheduler/commands.js";
import type { BackgroundRunner } from "./runner.js";
import { getAllBackgroundAgents } from "../db.js";

/**
 * Handle /background commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleBackgroundCommand(
  input: string,
  runner?: BackgroundRunner,
): CommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/background")) return null;

  const rest = trimmed.slice(11).trim();

  if (rest === "" || rest === "help") {
    return {
      text: [
        "Background agent commands:",
        "  /background register <name> <schedule>   Register a subagent for background execution",
        "  /background unregister <name>             Remove a background agent",
        "  /background list                          List registered background agents",
        "  /background suggest                       Show pending suggestions",
        "  /background accept <id>                   Accept a suggestion",
        "  /background dismiss <id>                  Dismiss a suggestion",
        "  /background status                        Show runner status",
        "",
        "Schedule format: every <N><s|m|h|d> (e.g., every 30m, every 1h)",
      ].join("\n"),
    };
  }

  if (rest === "status") {
    const status = runner?.status ?? "not started";
    const agents = getAllBackgroundAgents();
    const enabled = agents.filter((a) => a.enabled).length;
    return { text: `Background runner: ${status}\nRegistered agents: ${agents.length} (${enabled} enabled)` };
  }

  if (rest === "list") {
    const agents = getAllBackgroundAgents();
    if (agents.length === 0) {
      return { text: "No background agents registered. Use /background register <name> <schedule>." };
    }

    const lines = ["Background agents:\n"];
    for (const a of agents) {
      const status = a.enabled ? "on" : "off";
      const lastRun = a.lastRunAt ?? "never";
      lines.push(`  ${a.id}  [${status}]  ${a.name}  ${a.schedule}  last: ${lastRun}`);
      if (a.lastResult) {
        lines.push(`         result: ${a.lastResult.slice(0, 60)}${a.lastResult.length > 60 ? "..." : ""}`);
      }
    }
    return { text: lines.join("\n") };
  }

  if (rest === "register" || rest.startsWith("register ")) {
    const args = rest.slice(8).trim();
    const parts = args.split(/\s+/);
    if (parts.length < 2) {
      return { text: "Usage: /background register <name> <schedule>" };
    }
    const name = parts[0];
    const schedule = parts.slice(1).join(" ");

    if (!runner) {
      return { text: "Background runner is not available." };
    }

    try {
      const agent = runner.register(name, schedule);
      return { text: `Background agent "${agent.name}" (${agent.id}) registered with schedule: ${agent.schedule}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: `Error: ${msg}` };
    }
  }

  if (rest.startsWith("unregister ")) {
    const name = rest.slice(11).trim();
    if (!name) {
      return { text: "Usage: /background unregister <name>" };
    }
    if (!runner) {
      return { text: "Background runner is not available." };
    }
    const removed = runner.unregister(name);
    if (removed) {
      return { text: `Background agent "${name}" unregistered.` };
    }
    return { text: `No background agent named "${name}".` };
  }

  if (rest === "suggest") {
    if (!runner) {
      return { text: "Background runner is not available." };
    }
    const suggestions = runner.getSuggestions();
    if (suggestions.length === 0) {
      return { text: "No pending suggestions." };
    }

    const lines = ["Pending suggestions:\n"];
    for (const s of suggestions) {
      lines.push(`  ${s.id}  ${s.content.slice(0, 80)}${s.content.length > 80 ? "..." : ""}`);
    }
    lines.push("\nUse /background accept <id> or /background dismiss <id>.");
    return { text: lines.join("\n") };
  }

  if (rest.startsWith("accept ")) {
    const id = rest.slice(7).trim();
    if (!id || !runner) {
      return { text: "Usage: /background accept <id>" };
    }
    runner.acceptSuggestion(id);
    return { text: `Suggestion ${id} accepted.` };
  }

  if (rest.startsWith("dismiss ")) {
    const id = rest.slice(8).trim();
    if (!id || !runner) {
      return { text: "Usage: /background dismiss <id>" };
    }
    runner.dismissSuggestion(id);
    return { text: `Suggestion ${id} dismissed.` };
  }

  return { text: "Unknown background subcommand. Type /background help for usage." };
}
