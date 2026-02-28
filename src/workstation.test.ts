import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { isValidWorkstationName, resolveWorkstation } from "./workstation.js";
import {
  initDatabase,
  closeDatabase,
  addWorkstation,
  setDefaultWorkstation,
} from "./db.js";

describe("isValidWorkstationName", () => {
  it("accepts valid names", () => {
    assert.ok(isValidWorkstationName("dev"));
    assert.ok(isValidWorkstationName("my-server"));
    assert.ok(isValidWorkstationName("dev-1"));
    assert.ok(isValidWorkstationName("a"));
  });

  it("rejects invalid names", () => {
    assert.ok(!isValidWorkstationName(""));
    assert.ok(!isValidWorkstationName("-bad"));
    assert.ok(!isValidWorkstationName("HAS_CAPS"));
    assert.ok(!isValidWorkstationName("has spaces"));
    assert.ok(!isValidWorkstationName("has.dot"));
    assert.ok(!isValidWorkstationName("a".repeat(65)));
  });

  it("allows max length name", () => {
    assert.ok(isValidWorkstationName("a".repeat(64)));
  });
});

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-ws-test-${Date.now()}`);

describe("resolveWorkstation", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns undefined when no name given and no default", () => {
    const ws = resolveWorkstation();
    assert.strictEqual(ws, undefined);
  });

  it("returns undefined for 'local' magic name", () => {
    addWorkstation({ name: "dev", host: "1.2.3.4", cwd: "/home/user" });
    setDefaultWorkstation("dev");
    const ws = resolveWorkstation("local");
    assert.strictEqual(ws, undefined);
  });

  it("resolves explicit workstation by name", () => {
    addWorkstation({ name: "dev", host: "1.2.3.4", cwd: "/home/user" });
    const ws = resolveWorkstation("dev");
    assert.ok(ws);
    assert.strictEqual(ws.name, "dev");
    assert.strictEqual(ws.host, "1.2.3.4");
  });

  it("resolves config workstation when no explicit", () => {
    addWorkstation({ name: "staging", host: "5.6.7.8", cwd: "/app" });
    const ws = resolveWorkstation(undefined, "staging");
    assert.ok(ws);
    assert.strictEqual(ws.name, "staging");
  });

  it("throws for unknown workstation", () => {
    assert.throws(
      () => resolveWorkstation("nonexistent"),
      /Unknown workstation: nonexistent/,
    );
  });

  it("returns default workstation when no name given", () => {
    addWorkstation({ name: "prod", host: "9.9.9.9", cwd: "/srv" });
    setDefaultWorkstation("prod");
    const ws = resolveWorkstation();
    assert.ok(ws);
    assert.strictEqual(ws.name, "prod");
  });

  it("explicit name takes priority over config", () => {
    addWorkstation({ name: "dev", host: "1.1.1.1", cwd: "/a" });
    addWorkstation({ name: "staging", host: "2.2.2.2", cwd: "/b" });
    const ws = resolveWorkstation("dev", "staging");
    assert.ok(ws);
    assert.strictEqual(ws.name, "dev");
  });
});
