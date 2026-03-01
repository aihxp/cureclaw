import {
  getIdentityByScope,
  getAllIdentities,
  addIdentity,
  updateIdentity,
} from "../db.js";
import type { Identity } from "../types.js";

/** Resolve effective identity: channel-specific → global → null */
export function resolveIdentity(channelType?: string): Identity | null {
  if (channelType) {
    const specific = getIdentityByScope(channelType);
    if (specific) return specific;
  }
  return getIdentityByScope("global") ?? null;
}

/** Set an identity field. Creates identity if none exists for scope. */
export function setIdentityField(
  field: "name" | "greeting" | "prompt" | "avatar",
  value: string,
  scope = "global",
): Identity {
  const now = new Date().toISOString();
  const existing = getIdentityByScope(scope);

  if (existing) {
    const updates: Partial<Pick<Identity, "name" | "avatarUrl" | "systemPrompt" | "greeting" | "updatedAt">> = {
      updatedAt: now,
    };
    switch (field) {
      case "name":
        updates.name = value;
        break;
      case "greeting":
        updates.greeting = value;
        break;
      case "prompt":
        updates.systemPrompt = value;
        break;
      case "avatar":
        updates.avatarUrl = value;
        break;
    }
    updateIdentity(existing.id, updates);
    return { ...existing, ...updates } as Identity;
  }

  // Create new identity for this scope
  const identity: Omit<Identity, "id"> = {
    scope,
    name: field === "name" ? value : "CureClaw",
    avatarUrl: field === "avatar" ? value : null,
    systemPrompt: field === "prompt" ? value : null,
    greeting: field === "greeting" ? value : null,
    createdAt: now,
    updatedAt: now,
  };
  return addIdentity(identity);
}

/** Get system prompt for channel (or global fallback). */
export function getSystemPrompt(channelType?: string): string | null {
  const identity = resolveIdentity(channelType);
  return identity?.systemPrompt ?? null;
}

/** Get greeting for channel (or global fallback). */
export function getGreeting(channelType?: string): string | null {
  const identity = resolveIdentity(channelType);
  return identity?.greeting ?? null;
}

/** Format identity for display. */
export function formatIdentity(identity: Identity): string {
  const lines = [
    `Identity [${identity.scope}]:`,
    `  Name: ${identity.name}`,
  ];
  if (identity.avatarUrl) lines.push(`  Avatar: ${identity.avatarUrl}`);
  if (identity.systemPrompt) lines.push(`  System Prompt: ${identity.systemPrompt.slice(0, 100)}${identity.systemPrompt.length > 100 ? "..." : ""}`);
  if (identity.greeting) lines.push(`  Greeting: ${identity.greeting}`);
  lines.push(`  Updated: ${identity.updatedAt}`);
  return lines.join("\n");
}

/** Format identity list for display. */
export function formatIdentityList(identities: Identity[]): string {
  if (identities.length === 0) return "No identities configured. Use /identity set name \"YourName\" to create one.";

  const lines = ["Identities:\n"];
  for (const i of identities) {
    const parts = [`  [${i.scope}] ${i.name}`];
    if (i.greeting) parts.push(`greeting: "${i.greeting.slice(0, 40)}${i.greeting.length > 40 ? "..." : ""}"`);
    if (i.systemPrompt) parts.push("has system prompt");
    if (i.avatarUrl) parts.push("has avatar");
    lines.push(parts.join("  "));
  }
  return lines.join("\n");
}

export { getAllIdentities };
