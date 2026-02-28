import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventStream } from "./event-stream.js";

type TestEvent =
  | { type: "data"; value: number }
  | { type: "done"; result: string };

describe("EventStream", () => {
  it("delivers pushed events to async iterator", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e as Extract<TestEvent, { type: "done" }>).result,
    );

    stream.push({ type: "data", value: 1 });
    stream.push({ type: "data", value: 2 });
    stream.push({ type: "done", result: "finished" });

    const events: TestEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 3);
    assert.equal(events[0].type, "data");
    assert.equal(events[2].type, "done");
  });

  it("resolves result() with extracted value", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e as Extract<TestEvent, { type: "done" }>).result,
    );

    stream.push({ type: "done", result: "hello" });

    const result = await stream.result();
    assert.equal(result, "hello");
  });

  it("ignores pushes after completion", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e as Extract<TestEvent, { type: "done" }>).result,
    );

    stream.push({ type: "done", result: "first" });
    stream.push({ type: "data", value: 99 }); // should be ignored

    const events: TestEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "done");
  });

  it("end() terminates the stream", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e as Extract<TestEvent, { type: "done" }>).result,
    );

    stream.push({ type: "data", value: 1 });
    stream.end("manual-end");

    const events: TestEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    const result = await stream.result();
    assert.equal(result, "manual-end");
  });

  it("isDone reflects stream state", () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e as Extract<TestEvent, { type: "done" }>).result,
    );

    assert.equal(stream.isDone, false);
    stream.push({ type: "done", result: "x" });
    assert.equal(stream.isDone, true);
  });

  it("delivers events pushed while consumer is waiting", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e as Extract<TestEvent, { type: "done" }>).result,
    );

    // Push async — consumer will be waiting
    setTimeout(() => {
      stream.push({ type: "data", value: 42 });
      stream.push({ type: "done", result: "delayed" });
    }, 10);

    const events: TestEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { type: "data", value: 42 });
  });
});
