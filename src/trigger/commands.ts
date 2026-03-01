import {
  addTrigger,
  getAllTriggers,
  findTriggerByIdPrefix,
  removeTrigger,
  updateTrigger,
} from "../db.js";
import { isValidMode, type CursorMode } from "../mode.js";
import type { CommandContext, CommandResult } from "../scheduler/commands.js";
import type { ContextProvider, DeliveryTarget, TriggerCondition } from "../types.js";
import { parseContextProvider } from "./context.js";

const TRIGGER_HELP = `Usage:
  /trigger add webhook <name> "prompt" [options]
  /trigger add job-chain <job-id-prefix> <success|error|any> "prompt" [options]
  /trigger add cloud-complete <status|any> "prompt" [options]
  /trigger list
  /trigger remove <id-prefix>
  /trigger enable <id-prefix>
  /trigger disable <id-prefix>
  /trigger info <id-prefix>

Options:
  --context <specs>       Comma-separated: git_diff,git_log:20,shell:cmd,file:path
  --cloud                 Run in cloud mode
  --reflect               Enable reflection pass
  --workstation <name>    Target a workstation
  --mode <agent|plan|ask> Agent mode`;

/**
 * Handle /trigger commands.
 * Returns a CommandResult if the input matched a trigger command, null otherwise.
 */
export function handleTriggerCommand(input: string, ctx: CommandContext): CommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/trigger")) return null;

  const rest = trimmed.slice(8).trim();

  if (!rest || rest === "help") {
    return { text: TRIGGER_HELP };
  }

  if (rest === "list") {
    return handleList();
  }

  if (rest.startsWith("remove ")) {
    return handleRemove(rest.slice(7).trim());
  }

  if (rest.startsWith("enable ")) {
    return handleEnable(rest.slice(7).trim());
  }

  if (rest.startsWith("disable ")) {
    return handleDisable(rest.slice(8).trim());
  }

  if (rest.startsWith("info ")) {
    return handleInfo(rest.slice(5).trim());
  }

  if (rest.startsWith("add ")) {
    return handleAdd(rest.slice(4).trim(), ctx);
  }

  return { text: TRIGGER_HELP };
}

function handleAdd(args: string, ctx: CommandContext): CommandResult {
  const spaceIdx = args.indexOf(" ");
  const kind = spaceIdx === -1 ? args : args.slice(0, spaceIdx);
  const kindArgs = spaceIdx === -1 ? "" : args.slice(spaceIdx + 1).trim();

  switch (kind) {
    case "webhook":
      return handleAddWebhook(kindArgs, ctx);
    case "job-chain":
      return handleAddJobChain(kindArgs, ctx);
    case "cloud-complete":
      return handleAddCloudComplete(kindArgs, ctx);
    default:
      return {
        text: "Unknown trigger kind. Use: webhook, job-chain, cloud-complete",
      };
  }
}

function handleAddWebhook(args: string, ctx: CommandContext): CommandResult {
  // webhook <name> "prompt" [options]
  const match = args.match(/^(\S+)\s+"((?:[^"\\]|\\.)*)"\s*(.*)$/);
  if (!match) {
    return {
      text: 'Usage: /trigger add webhook <name> "prompt" [--context ...] [--cloud] [--reflect]',
    };
  }

  const name = match[1];
  const prompt = match[2].replace(/\\"/g, '"');
  const optStr = match[3];

  const condition: TriggerCondition = { kind: "webhook", name };
  return createTrigger(name, condition, prompt, optStr, ctx);
}

function handleAddJobChain(args: string, ctx: CommandContext): CommandResult {
  // job-chain <job-id-prefix> <success|error|any> "prompt" [options]
  const match = args.match(/^(\S+)\s+(success|error|any)\s+"((?:[^"\\]|\\.)*)"\s*(.*)$/);
  if (!match) {
    return {
      text: 'Usage: /trigger add job-chain <job-id-prefix> <success|error|any> "prompt" [options]',
    };
  }

  const jobId = match[1];
  const onStatus = match[2] as "success" | "error" | "any";
  const prompt = match[3].replace(/\\"/g, '"');
  const optStr = match[4];
  const name = `chain-${jobId.slice(0, 8)}`;

  const condition: TriggerCondition = { kind: "job_complete", jobId, onStatus };
  return createTrigger(name, condition, prompt, optStr, ctx);
}

function handleAddCloudComplete(args: string, ctx: CommandContext): CommandResult {
  // cloud-complete <status|any> "prompt" [options]
  const match = args.match(/^(\S+)\s+"((?:[^"\\]|\\.)*)"\s*(.*)$/);
  if (!match) {
    return {
      text: 'Usage: /trigger add cloud-complete <status|any> "prompt" [options]',
    };
  }

  const onStatus = match[1];
  const prompt = match[2].replace(/\\"/g, '"');
  const optStr = match[3];
  const name = `cloud-${onStatus.toLowerCase()}`;

  const condition: TriggerCondition = { kind: "cloud_complete", onStatus };
  return createTrigger(name, condition, prompt, optStr, ctx);
}

function createTrigger(
  name: string,
  condition: TriggerCondition,
  prompt: string,
  optStr: string,
  ctx: CommandContext,
): CommandResult {
  if (!prompt) {
    return { text: "Prompt cannot be empty." };
  }

  const { cloud, reflect, workstation, mode, contextProviders } = parseOptions(optStr);

  const delivery: DeliveryTarget =
    ctx.channelType === "cli"
      ? { kind: "store" }
      : { kind: "channel", channelType: ctx.channelType, channelId: ctx.channelId };

  try {
    const trigger = addTrigger({
      name,
      condition,
      prompt,
      contextProviders,
      delivery,
      cloud,
      reflect,
      workstation,
      mode,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    return {
      text: `Trigger ${trigger.id} created.\nName: ${trigger.name}\nKind: ${condition.kind}\nDelivery: ${formatDelivery(delivery)}${cloud ? "\nCloud: yes" : ""}${reflect ? "\nReflect: on" : ""}${workstation ? `\nWorkstation: ${workstation}` : ""}${mode ? `\nMode: ${mode}` : ""}${contextProviders.length > 0 ? `\nContext: ${contextProviders.map((p) => p.kind + (p.arg ? ":" + p.arg : "")).join(", ")}` : ""}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error creating trigger: ${msg}` };
  }
}

function parseOptions(optStr: string): {
  cloud: boolean;
  reflect: boolean;
  workstation?: string;
  mode?: CursorMode;
  contextProviders: ContextProvider[];
} {
  let str = optStr;
  let cloud = false;
  let reflect = false;
  let workstation: string | undefined;
  let mode: CursorMode | undefined;
  const contextProviders: ContextProvider[] = [];

  // Extract --context
  const ctxMatch = str.match(/--context\s+(\S+)/);
  if (ctxMatch) {
    const specs = ctxMatch[1].split(",");
    for (const spec of specs) {
      try {
        contextProviders.push(parseContextProvider(spec));
      } catch {
        // skip invalid
      }
    }
    str = str.replace(/--context\s+\S+/, "").trim();
  }

  // Extract --workstation
  const wsMatch = str.match(/--workstation\s+(\S+)/);
  if (wsMatch) {
    workstation = wsMatch[1];
    str = str.replace(/--workstation\s+\S+/, "").trim();
  }

  // Extract --mode
  const modeMatch = str.match(/--mode\s+(\S+)/);
  if (modeMatch) {
    if (isValidMode(modeMatch[1])) {
      mode = modeMatch[1];
    }
    str = str.replace(/--mode\s+\S+/, "").trim();
  }

  if (str.includes("--cloud")) {
    cloud = true;
  }
  if (str.includes("--reflect")) {
    reflect = true;
  }

  return { cloud, reflect, workstation, mode, contextProviders };
}

function handleList(): CommandResult {
  const triggers = getAllTriggers();
  if (triggers.length === 0) {
    return { text: "No triggers configured." };
  }

  const lines = ["Triggers:\n"];
  for (const t of triggers) {
    const status = t.enabled ? "on" : "off";
    const lastInfo = t.lastStatus
      ? ` | last: ${t.lastStatus}${t.lastFiredAt ? " " + formatDate(t.lastFiredAt) : ""}`
      : "";
    const fireInfo = t.fireCount > 0 ? ` | fired: ${t.fireCount}` : "";
    lines.push(`  ${t.id}  [${status}]  ${t.condition.kind}  "${t.name}"`);
    lines.push(`         ${formatCondition(t)}${lastInfo}${fireInfo}`);
  }

  return { text: lines.join("\n") };
}

function handleRemove(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /trigger remove <id-prefix>" };
  }

  const trigger = findTriggerByIdPrefix(idPrefix);
  if (!trigger) {
    return { text: `No trigger found matching "${idPrefix}".` };
  }

  removeTrigger(trigger.id);
  return { text: `Trigger ${trigger.id} ("${trigger.name}") removed.` };
}

function handleEnable(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /trigger enable <id-prefix>" };
  }

  const trigger = findTriggerByIdPrefix(idPrefix);
  if (!trigger) {
    return { text: `No trigger found matching "${idPrefix}".` };
  }

  updateTrigger(trigger.id, { enabled: true });
  return { text: `Trigger ${trigger.id} ("${trigger.name}") enabled.` };
}

function handleDisable(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /trigger disable <id-prefix>" };
  }

  const trigger = findTriggerByIdPrefix(idPrefix);
  if (!trigger) {
    return { text: `No trigger found matching "${idPrefix}".` };
  }

  updateTrigger(trigger.id, { enabled: false });
  return { text: `Trigger ${trigger.id} ("${trigger.name}") disabled.` };
}

function handleInfo(idPrefix: string): CommandResult {
  if (!idPrefix) {
    return { text: "Usage: /trigger info <id-prefix>" };
  }

  const trigger = findTriggerByIdPrefix(idPrefix);
  if (!trigger) {
    return { text: `No trigger found matching "${idPrefix}".` };
  }

  const lines = [
    `Trigger: ${trigger.name}`,
    `ID: ${trigger.id}`,
    `Kind: ${trigger.condition.kind}`,
    `Condition: ${formatCondition(trigger)}`,
    `Prompt: ${trigger.prompt}`,
    `Status: ${trigger.enabled ? "enabled" : "disabled"}`,
    `Cloud: ${trigger.cloud ? "yes" : "no"}`,
    `Reflect: ${trigger.reflect ? "on" : "off"}`,
    `Delivery: ${formatDelivery(trigger.delivery)}`,
    `Created: ${formatDate(trigger.createdAt)}`,
    `Fired: ${trigger.fireCount} time${trigger.fireCount === 1 ? "" : "s"}`,
  ];

  if (trigger.lastFiredAt) {
    lines.push(`Last fired: ${formatDate(trigger.lastFiredAt)}`);
  }
  if (trigger.lastStatus) {
    lines.push(`Last status: ${trigger.lastStatus}`);
  }
  if (trigger.lastError) {
    lines.push(`Last error: ${trigger.lastError}`);
  }
  if (trigger.workstation) {
    lines.push(`Workstation: ${trigger.workstation}`);
  }
  if (trigger.mode) {
    lines.push(`Mode: ${trigger.mode}`);
  }
  if (trigger.contextProviders.length > 0) {
    lines.push(
      `Context: ${trigger.contextProviders.map((p) => p.kind + (p.arg ? ":" + p.arg : "")).join(", ")}`,
    );
  }

  return { text: lines.join("\n") };
}

function formatCondition(t: { condition: TriggerCondition }): string {
  switch (t.condition.kind) {
    case "webhook":
      return `webhook: ${t.condition.name}`;
    case "job_complete":
      return `job: ${t.condition.jobId} on ${t.condition.onStatus}`;
    case "cloud_complete":
      return `cloud: on ${t.condition.onStatus}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDelivery(d: DeliveryTarget): string {
  if (d.kind === "store") return "store only";
  return `${d.channelType}:${d.channelId}`;
}
