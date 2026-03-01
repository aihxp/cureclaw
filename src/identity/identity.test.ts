import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, closeDatabase, getIdentityByScope } from "../db.js";
import {
  resolveIdentity,
  setIdentityField,
  getSystemPrompt,
  getGreeting,
  formatIdentity,
  formatIdentityList,
  getAllIdentities,
} from "./identity.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cureclaw-identity-test-"));
  initDatabase(tmpDir);
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveIdentity", () => {
  it("should return null when no identities exist", () => {
    assert.equal(resolveIdentity(), null);
  });

  it("should return global identity", () => {
    setIdentityField("name", "TestBot");
    const identity = resolveIdentity();
    assert.ok(identity);
    assert.equal(identity.name, "TestBot");
    assert.equal(identity.scope, "global");
  });

  it("should return channel-specific identity over global", () => {
    setIdentityField("name", "GlobalBot");
    setIdentityField("name", "SlackBot", "slack");
    const identity = resolveIdentity("slack");
    assert.ok(identity);
    assert.equal(identity.name, "SlackBot");
  });

  it("should fall back to global when channel-specific not found", () => {
    setIdentityField("name", "GlobalBot");
    const identity = resolveIdentity("discord");
    assert.ok(identity);
    assert.equal(identity.name, "GlobalBot");
  });
});

describe("setIdentityField", () => {
  it("should create new identity for scope", () => {
    const identity = setIdentityField("name", "MyBot");
    assert.equal(identity.scope, "global");
    assert.equal(identity.name, "MyBot");
  });

  it("should update existing identity", () => {
    setIdentityField("name", "Bot1");
    const updated = setIdentityField("name", "Bot2");
    assert.equal(updated.name, "Bot2");
    assert.equal(updated.scope, "global");
  });

  it("should set greeting field", () => {
    const identity = setIdentityField("greeting", "Hello!");
    assert.equal(identity.greeting, "Hello!");
  });

  it("should set prompt field", () => {
    const identity = setIdentityField("prompt", "You are helpful");
    assert.equal(identity.systemPrompt, "You are helpful");
  });

  it("should set avatar field", () => {
    const identity = setIdentityField("avatar", "https://example.com/pic.png");
    assert.equal(identity.avatarUrl, "https://example.com/pic.png");
  });

  it("should create per-channel identity", () => {
    const identity = setIdentityField("name", "TelegramBot", "telegram");
    assert.equal(identity.scope, "telegram");
    assert.equal(identity.name, "TelegramBot");
  });
});

describe("getSystemPrompt", () => {
  it("should return null when no identity exists", () => {
    assert.equal(getSystemPrompt(), null);
  });

  it("should return global system prompt", () => {
    setIdentityField("prompt", "Be helpful");
    assert.equal(getSystemPrompt(), "Be helpful");
  });

  it("should return channel-specific prompt over global", () => {
    setIdentityField("prompt", "Global prompt");
    setIdentityField("prompt", "Slack prompt", "slack");
    assert.equal(getSystemPrompt("slack"), "Slack prompt");
  });

  it("should fall back to global prompt", () => {
    setIdentityField("prompt", "Global prompt");
    assert.equal(getSystemPrompt("discord"), "Global prompt");
  });
});

describe("getGreeting", () => {
  it("should return null when no identity exists", () => {
    assert.equal(getGreeting(), null);
  });

  it("should return greeting for channel", () => {
    setIdentityField("greeting", "Hi from Telegram!", "telegram");
    assert.equal(getGreeting("telegram"), "Hi from Telegram!");
  });

  it("should fall back to global greeting", () => {
    setIdentityField("greeting", "Hello!");
    assert.equal(getGreeting("slack"), "Hello!");
  });
});

describe("formatIdentity", () => {
  it("should format identity for display", () => {
    const identity = setIdentityField("name", "TestBot");
    const formatted = formatIdentity(identity);
    assert.ok(formatted.includes("TestBot"));
    assert.ok(formatted.includes("global"));
  });
});

describe("formatIdentityList", () => {
  it("should show message when no identities", () => {
    const text = formatIdentityList([]);
    assert.ok(text.includes("No identities"));
  });

  it("should list multiple identities", () => {
    setIdentityField("name", "GlobalBot");
    setIdentityField("name", "SlackBot", "slack");
    const identities = getAllIdentities();
    const text = formatIdentityList(identities);
    assert.ok(text.includes("GlobalBot"));
    assert.ok(text.includes("SlackBot"));
  });
});
