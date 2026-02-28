import type { DeliveryTarget } from "../types.js";

export type DeliveryHandler = (channelId: string, text: string) => Promise<void>;

const handlers = new Map<string, DeliveryHandler>();

export function registerDeliveryHandler(channelType: string, fn: DeliveryHandler): void {
  handlers.set(channelType, fn);
}

export function unregisterDeliveryHandler(channelType: string): void {
  handlers.delete(channelType);
}

export async function deliver(target: DeliveryTarget, result: string): Promise<void> {
  if (target.kind === "store") {
    // Result is already persisted in the DB by the scheduler — nothing more to do
    return;
  }

  const handler = handlers.get(target.channelType);
  if (!handler) {
    console.warn(
      `[delivery] No handler registered for channel type "${target.channelType}", result stored only.`,
    );
    return;
  }

  await handler(target.channelId, result);
}
