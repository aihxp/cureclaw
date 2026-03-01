import type { CommandResult } from "../scheduler/commands.js";
import { notify, formatNotificationList, getRecentNotifications } from "./notify.js";

/**
 * Handle /notify commands.
 * Returns CommandResult if matched, null otherwise.
 */
export function handleNotifyCommand(
  input: string,
): CommandResult | null | Promise<CommandResult> {
  const trimmed = input.trim();

  if (trimmed === "/notify" || trimmed === "/notify help") {
    return { text: notifyHelp() };
  }

  if (trimmed === "/notify log" || trimmed.startsWith("/notify log ")) {
    return handleLog(trimmed.slice(11).trim());
  }

  if (trimmed.startsWith("/notify ")) {
    return handleSend(trimmed.slice(8).trim());
  }

  return null;
}

function handleLog(args: string): CommandResult {
  const limit = args ? parseInt(args, 10) : 20;
  const notifs = getRecentNotifications(isNaN(limit) ? 20 : limit);
  return { text: formatNotificationList(notifs) };
}

async function handleSend(args: string): Promise<CommandResult> {
  // Parse: <channelType>:<channelId> "message"
  const match = args.match(/^(\S+):(\S+)\s+(.+)$/s);
  if (!match) {
    return { text: 'Usage: /notify <channelType>:<channelId> "message"\nExample: /notify telegram:123456789 "Deployment complete"' };
  }

  const channelType = match[1];
  const channelId = match[2];
  let message = match[3].trim();

  // Strip surrounding quotes if present
  if ((message.startsWith('"') && message.endsWith('"')) || (message.startsWith("'") && message.endsWith("'"))) {
    message = message.slice(1, -1);
  }

  if (!message) {
    return { text: "Message cannot be empty." };
  }

  const result = await notify(channelType, channelId, message);
  if (result.status === "sent") {
    return { text: `Notification sent to ${channelType}:${channelId}` };
  }
  return { text: `Notification failed: ${result.error ?? "unknown error"}` };
}

function notifyHelp(): string {
  return [
    "Notification commands:",
    "",
    '  /notify <channelType>:<channelId> "message"   Send a notification',
    "  /notify log [limit]                            Show recent notifications",
    "  /notify help                                   Show this help",
    "",
    "Examples:",
    '  /notify telegram:123456789 "Deployment complete"',
    '  /notify slack:C04ABCD1234 "Tests passed"',
    "  /notify log 10",
  ].join("\n");
}
