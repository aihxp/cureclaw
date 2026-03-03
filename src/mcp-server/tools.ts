import type { McpToolDefinition, McpToolResult } from "./protocol.js";
import {
  getAllSessions,
  getHistory,
  getAllJobs,
  getAllMemories,
  searchMemory,
  addMemory,
  getAllBackgroundAgents,
  getPendingSuggestions,
  getAllWorkflows,
  getAllTriggers,
  getAllWorktrees,
  getAllSpawned,
  getActiveMonitors,
  getAllReviews,
} from "../db.js";
import {
  getActiveAgentRuns,
  getRecentAgentRuns,
} from "../fleet/registry.js";

/** Tool definitions exposed by the CureClaw MCP server. */
export const toolDefinitions: McpToolDefinition[] = [
  {
    name: "cureclaw_status",
    description: "Get CureClaw system status (version, counts for sessions, jobs, agents, memory, workflows)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cureclaw_sessions",
    description: "List CureClaw sessions or get history for a specific session",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "history"],
          description: "Action to perform: list all sessions, or get history for a specific session key",
        },
        sessionKey: {
          type: "string",
          description: "Session key (required for history action)",
        },
        limit: {
          type: "number",
          description: "Number of history entries to return (default: 10)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_jobs",
    description: "List scheduled jobs with their status",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list"],
          description: "Action to perform",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_memory",
    description: "Search, list, or add memories",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "search", "add"],
          description: "Action: list all, search by query, or add a new memory",
        },
        query: {
          type: "string",
          description: "Search query (for search action)",
        },
        key: {
          type: "string",
          description: "Memory key (for add action)",
        },
        content: {
          type: "string",
          description: "Memory content (for add action)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_agents",
    description: "Get background agent status and pending suggestions",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "suggestions"],
          description: "Action: list background agents, or show pending suggestions",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_workflows",
    description: "List workflows with status",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list"],
          description: "Action to perform",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_runs",
    description: "List agent runs (active or recent)",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["active", "recent"],
          description: "Show active or recent runs",
        },
        limit: {
          type: "number",
          description: "Number of recent runs to return (default: 20)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_triggers",
    description: "List triggers with fire counts",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list"],
          description: "Action to perform",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_worktrees",
    description: "List git worktrees used for agent isolation",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list"],
          description: "Action to perform",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_processes",
    description: "List spawned background processes",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list"],
          description: "Action to perform",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_monitors",
    description: "List active CI/PR monitors",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list"],
          description: "Action to perform",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cureclaw_reviews",
    description: "List code reviews",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list"],
          description: "Action to perform",
        },
      },
      required: ["action"],
    },
  },
];

/** Handle a tool call and return the result. */
export function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
): McpToolResult {
  try {
    switch (toolName) {
      case "cureclaw_status":
        return handleStatus();
      case "cureclaw_sessions":
        return handleSessions(args);
      case "cureclaw_jobs":
        return handleJobs();
      case "cureclaw_memory":
        return handleMemory(args);
      case "cureclaw_agents":
        return handleAgents(args);
      case "cureclaw_workflows":
        return handleWorkflows();
      case "cureclaw_runs":
        return handleRuns(args);
      case "cureclaw_triggers":
        return handleTriggers();
      case "cureclaw_worktrees":
        return handleWorktrees();
      case "cureclaw_processes":
        return handleProcesses();
      case "cureclaw_monitors":
        return handleMonitors();
      case "cureclaw_reviews":
        return handleReviews();
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

function handleStatus(): McpToolResult {
  const sessions = getAllSessions();
  const jobs = getAllJobs();
  const memories = getAllMemories();
  const agents = getAllBackgroundAgents();
  const workflows = getAllWorkflows();
  const activeRuns = getActiveAgentRuns();
  const triggers = getAllTriggers();

  const text = [
    "CureClaw v1.2 Status",
    `Sessions: ${sessions.length}`,
    `Jobs: ${jobs.length} (${jobs.filter((j) => j.enabled).length} enabled)`,
    `Memories: ${memories.length}`,
    `Background Agents: ${agents.length} (${agents.filter((a) => a.enabled).length} enabled)`,
    `Workflows: ${workflows.length}`,
    `Active Runs: ${activeRuns.length}`,
    `Triggers: ${triggers.length} (${triggers.filter((t) => t.enabled).length} enabled)`,
  ].join("\n");

  return { content: [{ type: "text", text }] };
}

function handleSessions(args: Record<string, unknown>): McpToolResult {
  const action = args.action as string;

  if (action === "list") {
    const sessions = getAllSessions();
    if (sessions.length === 0) {
      return { content: [{ type: "text", text: "No sessions." }] };
    }
    const lines = sessions.map(
      (s) => `${s.cwd} | session:${s.session_id.slice(0, 8)} | model:${s.model ?? "auto"} | ${s.updated_at}`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (action === "history") {
    const key = args.sessionKey as string;
    if (!key) {
      return { content: [{ type: "text", text: "sessionKey is required for history action." }], isError: true };
    }
    const limit = (args.limit as number) ?? 10;
    const entries = getHistory(key, limit);
    if (entries.length === 0) {
      return { content: [{ type: "text", text: `No history for "${key}".` }] };
    }
    const lines = entries.map(
      (e) => `[${e.created_at}] ${e.prompt.slice(0, 80)}${e.prompt.length > 80 ? "..." : ""} → ${e.result?.slice(0, 80) ?? "(no result)"}`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return { content: [{ type: "text", text: "Invalid action. Use 'list' or 'history'." }], isError: true };
}

function handleJobs(): McpToolResult {
  const jobs = getAllJobs();
  if (jobs.length === 0) {
    return { content: [{ type: "text", text: "No scheduled jobs." }] };
  }
  const lines = jobs.map((j) => {
    const status = j.enabled ? "enabled" : "disabled";
    const lastRun = j.lastRunAt ? `last:${j.lastRunAt}` : "never run";
    return `${j.id} | ${j.name} | ${status} | ${lastRun} | next:${j.nextRunAt ?? "none"}`;
  });
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleMemory(args: Record<string, unknown>): McpToolResult {
  const action = args.action as string;

  if (action === "list") {
    const memories = getAllMemories();
    if (memories.length === 0) {
      return { content: [{ type: "text", text: "No memories stored." }] };
    }
    const lines = memories.map(
      (m) => `[${m.key}] ${m.content.slice(0, 100)}${m.content.length > 100 ? "..." : ""} (tags: ${m.tags.join(", ") || "none"})`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (action === "search") {
    const query = args.query as string;
    if (!query) {
      return { content: [{ type: "text", text: "query is required for search action." }], isError: true };
    }
    const results = searchMemory(query);
    if (results.length === 0) {
      return { content: [{ type: "text", text: `No memories matching "${query}".` }] };
    }
    const lines = results.map(
      (m) => `[${m.key}] ${m.content.slice(0, 100)}${m.content.length > 100 ? "..." : ""}`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (action === "add") {
    const key = args.key as string;
    const content = args.content as string;
    if (!key || !content) {
      return { content: [{ type: "text", text: "key and content are required for add action." }], isError: true };
    }
    const now = new Date().toISOString();
    addMemory({ key, content, tags: [], source: "mcp", createdAt: now, updatedAt: now });
    return { content: [{ type: "text", text: `Memory "${key}" added.` }] };
  }

  return { content: [{ type: "text", text: "Invalid action. Use 'list', 'search', or 'add'." }], isError: true };
}

function handleAgents(args: Record<string, unknown>): McpToolResult {
  const action = args.action as string;

  if (action === "list") {
    const agents = getAllBackgroundAgents();
    if (agents.length === 0) {
      return { content: [{ type: "text", text: "No background agents registered." }] };
    }
    const lines = agents.map((a) => {
      const status = a.enabled ? "enabled" : "disabled";
      const lastRun = a.lastRunAt ?? "never";
      return `${a.id} | ${a.name} | ${status} | schedule:${a.schedule} | lastRun:${lastRun}`;
    });
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (action === "suggestions") {
    const suggestions = getPendingSuggestions();
    if (suggestions.length === 0) {
      return { content: [{ type: "text", text: "No pending suggestions." }] };
    }
    const lines = suggestions.map(
      (s) => `${s.id} | agent:${s.backgroundAgentId} | ${s.content.slice(0, 100)}`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return { content: [{ type: "text", text: "Invalid action. Use 'list' or 'suggestions'." }], isError: true };
}

function handleWorkflows(): McpToolResult {
  const workflows = getAllWorkflows();
  if (workflows.length === 0) {
    return { content: [{ type: "text", text: "No workflows." }] };
  }
  const lines = workflows.map(
    (w) => `${w.id} | ${w.name} | ${w.status} | steps:${w.steps.length} | current:${w.currentStep}`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleRuns(args: Record<string, unknown>): McpToolResult {
  const action = args.action as string;

  if (action === "active") {
    const runs = getActiveAgentRuns();
    if (runs.length === 0) {
      return { content: [{ type: "text", text: "No active runs." }] };
    }
    const lines = runs.map(
      (r) => `${r.id} | ${r.kind} | ${r.label.slice(0, 60)} | started:${r.startedAt}`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (action === "recent") {
    const limit = (args.limit as number) ?? 20;
    const runs = getRecentAgentRuns(limit);
    if (runs.length === 0) {
      return { content: [{ type: "text", text: "No agent runs." }] };
    }
    const lines = runs.map(
      (r) => `${r.id} | ${r.kind} | ${r.status} | ${r.label.slice(0, 60)} | ${r.startedAt}`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return { content: [{ type: "text", text: "Invalid action. Use 'active' or 'recent'." }], isError: true };
}

function handleTriggers(): McpToolResult {
  const triggers = getAllTriggers();
  if (triggers.length === 0) {
    return { content: [{ type: "text", text: "No triggers configured." }] };
  }
  const lines = triggers.map((t) => {
    const status = t.enabled ? "enabled" : "disabled";
    return `${t.id} | ${t.name} | ${t.condition.kind} | ${status} | fires:${t.fireCount} | lastFired:${t.lastFiredAt ?? "never"}`;
  });
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleWorktrees(): McpToolResult {
  const worktrees = getAllWorktrees();
  if (worktrees.length === 0) {
    return { content: [{ type: "text", text: "No worktrees." }] };
  }
  const lines = worktrees.map(
    (w) => `${w.id} | ${w.branch} | ${w.status} | base:${w.baseBranch} | ${w.path}`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleProcesses(): McpToolResult {
  const processes = getAllSpawned();
  if (processes.length === 0) {
    return { content: [{ type: "text", text: "No spawned processes." }] };
  }
  const lines = processes.map((p) => {
    const pid = p.pid ? `pid:${p.pid}` : "no-pid";
    return `${p.id} | ${p.name} | ${p.status} | ${pid} | cmd:${p.command.slice(0, 60)}`;
  });
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleMonitors(): McpToolResult {
  const monitors = getActiveMonitors();
  if (monitors.length === 0) {
    return { content: [{ type: "text", text: "No active monitors." }] };
  }
  const lines = monitors.map((m) => {
    const autoFix = m.autoFix ? `auto-fix(${m.retryCount}/${m.maxRetries})` : "manual";
    return `${m.id} | ${m.branch} | ${m.ciStatus} | ${autoFix} | lastCheck:${m.lastCheckAt ?? "never"}`;
  });
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleReviews(): McpToolResult {
  const reviews = getAllReviews();
  if (reviews.length === 0) {
    return { content: [{ type: "text", text: "No reviews." }] };
  }
  const lines = reviews.map(
    (r) => `${r.id} | ${r.branch} | ${r.status} | models:${r.models.join(",")} | ${r.createdAt}`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
