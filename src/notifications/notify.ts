import { addNotificationLog, getRecentNotifications } from "../db.js";
import type { NotificationLog } from "../types.js";

/**
 * Send a notification to a channel. Uses the delivery handler system.
 * Logs every attempt (sent or failed) to notification_log table.
 */
export async function notify(
  channelType: string,
  channelId: string,
  message: string,
  source = "manual",
): Promise<NotificationLog> {
  const now = new Date().toISOString();

  try {
    // Dynamic import to avoid circular deps with delivery.ts
    const { deliver } = await import("../scheduler/delivery.js");
    await deliver(
      { kind: "channel", channelType, channelId },
      message,
    );

    return addNotificationLog({
      channelType,
      channelId,
      message,
      source,
      status: "sent",
      error: null,
      createdAt: now,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return addNotificationLog({
      channelType,
      channelId,
      message,
      source,
      status: "failed",
      error,
      createdAt: now,
    });
  }
}

/** Format notification log for display. */
export function formatNotificationList(notifs: NotificationLog[]): string {
  if (notifs.length === 0) return "No notifications.";

  const lines = ["Recent notifications:\n"];
  for (const n of notifs) {
    const statusIcon = n.status === "sent" ? "+" : "x";
    const errorStr = n.error ? ` (${n.error.slice(0, 50)})` : "";
    lines.push(
      `  [${statusIcon}] ${n.channelType}:${n.channelId}  ${n.source}  ${n.message.slice(0, 60)}${n.message.length > 60 ? "..." : ""}${errorStr}`,
    );
    lines.push(`       ${n.createdAt}`);
  }
  return lines.join("\n");
}

export { getRecentNotifications };
