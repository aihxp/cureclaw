import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { handleWorkstationCommand } from "./workstation-commands.js";
import {
  initDatabase,
  closeDatabase,
  getAllWorkstations,
  getWorkstation,
  addWorkstation,
} from "./db.js";

const TEST_DIR = path.join(os.tmpdir(), `cureclaw-ws-cmd-test-${Date.now()}`);

describe("workstation commands", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    initDatabase(TEST_DIR);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-workstation commands", () => {
    assert.strictEqual(handleWorkstationCommand("/help"), null);
    assert.strictEqual(handleWorkstationCommand("/schedule foo"), null);
    assert.strictEqual(handleWorkstationCommand("hello"), null);
  });

  it("shows usage for bare /workstation", () => {
    const result = handleWorkstationCommand("/workstation");
    assert.ok(result);
    assert.ok(result.text.includes("Workstation commands"));
  });

  describe("/workstation add", () => {
    it("adds a workstation", () => {
      const result = handleWorkstationCommand(
        "/workstation add dev user@192.168.1.100 /home/user/project",
      );
      assert.ok(result);
      assert.ok(result.text.includes("added"));

      const ws = getWorkstation("dev");
      assert.ok(ws);
      assert.strictEqual(ws.host, "192.168.1.100");
      assert.strictEqual(ws.user, "user");
      assert.strictEqual(ws.cwd, "/home/user/project");
    });

    it("adds workstation with optional flags", () => {
      const result = handleWorkstationCommand(
        "/workstation add staging admin@10.0.0.1 /app --port 2222 --key ~/.ssh/id_staging",
      );
      assert.ok(result);
      assert.ok(result.text.includes("added"));

      const ws = getWorkstation("staging");
      assert.ok(ws);
      assert.strictEqual(ws.port, 2222);
      assert.strictEqual(ws.identityFile, "~/.ssh/id_staging");
    });

    it("rejects invalid name", () => {
      const result = handleWorkstationCommand(
        "/workstation add BAD_NAME user@host /cwd",
      );
      assert.ok(result);
      assert.ok(result.text.includes("Invalid name"));
    });

    it("rejects duplicate name", () => {
      handleWorkstationCommand("/workstation add dev user@host /cwd");
      const result = handleWorkstationCommand("/workstation add dev user@host /cwd");
      assert.ok(result);
      assert.ok(result.text.includes("already exists"));
    });

    it("shows usage on too few args", () => {
      const result = handleWorkstationCommand("/workstation add dev");
      assert.ok(result);
      assert.ok(result.text.includes("Usage"));
    });

    it("handles host without user", () => {
      handleWorkstationCommand("/workstation add bare 10.0.0.5 /srv");
      const ws = getWorkstation("bare");
      assert.ok(ws);
      assert.strictEqual(ws.user, undefined);
      assert.strictEqual(ws.host, "10.0.0.5");
    });
  });

  describe("/workstation remove", () => {
    it("removes an existing workstation", () => {
      handleWorkstationCommand("/workstation add dev user@host /cwd");
      const result = handleWorkstationCommand("/workstation remove dev");
      assert.ok(result);
      assert.ok(result.text.includes("removed"));
      assert.strictEqual(getAllWorkstations().length, 0);
    });

    it("reports not found", () => {
      const result = handleWorkstationCommand("/workstation remove nope");
      assert.ok(result);
      assert.ok(result.text.includes("not found"));
    });
  });

  describe("/workstation list", () => {
    it("shows no workstations message when empty", () => {
      const result = handleWorkstationCommand("/workstation list");
      assert.ok(result);
      assert.ok(result.text.includes("No workstations"));
    });

    it("lists registered workstations", () => {
      handleWorkstationCommand("/workstation add dev user@host /cwd");
      const result = handleWorkstationCommand("/workstation list");
      assert.ok(result);
      assert.ok(result.text.includes("dev"));
      assert.ok(result.text.includes("user@host"));
    });
  });

  describe("/workstation default", () => {
    it("sets default workstation", () => {
      handleWorkstationCommand("/workstation add dev user@host /cwd");
      const result = handleWorkstationCommand("/workstation default dev");
      assert.ok(result);
      assert.ok(result.text.includes("set to"));

      const ws = getWorkstation("dev");
      assert.ok(ws);
      assert.strictEqual(ws.isDefault, true);
    });

    it("clears default with 'local'", () => {
      addWorkstation({ name: "dev", host: "h", cwd: "/c", isDefault: true });
      const result = handleWorkstationCommand("/workstation default local");
      assert.ok(result);
      assert.ok(result.text.includes("cleared"));
    });

    it("reports not found", () => {
      const result = handleWorkstationCommand("/workstation default nope");
      assert.ok(result);
      assert.ok(result.text.includes("not found"));
    });
  });

  describe("/workstation status", () => {
    it("returns testing message for known workstation", () => {
      handleWorkstationCommand("/workstation add dev user@host /cwd");
      const result = handleWorkstationCommand("/workstation status dev");
      assert.ok(result);
      assert.ok(result.text.includes("Testing SSH"));
    });

    it("reports not found", () => {
      const result = handleWorkstationCommand("/workstation status nope");
      assert.ok(result);
      assert.ok(result.text.includes("not found"));
    });
  });
});
