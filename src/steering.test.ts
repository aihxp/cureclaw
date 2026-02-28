import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SteeringQueue } from "./steering.js";

describe("SteeringQueue", () => {
  it("enqueues and dequeues in FIFO order", () => {
    const q = new SteeringQueue();
    q.enqueue("first");
    q.enqueue("second");
    q.enqueue("third");
    assert.equal(q.dequeue(), "first");
    assert.equal(q.dequeue(), "second");
    assert.equal(q.dequeue(), "third");
    assert.equal(q.dequeue(), undefined);
  });

  it("tracks length correctly", () => {
    const q = new SteeringQueue();
    assert.equal(q.length, 0);
    q.enqueue("a");
    assert.equal(q.length, 1);
    q.enqueue("b");
    assert.equal(q.length, 2);
    q.dequeue();
    assert.equal(q.length, 1);
  });

  it("drainAll returns all items and empties queue", () => {
    const q = new SteeringQueue();
    q.enqueue("x");
    q.enqueue("y");
    q.enqueue("z");
    const items = q.drainAll();
    assert.deepEqual(items, ["x", "y", "z"]);
    assert.equal(q.length, 0);
    assert.equal(q.dequeue(), undefined);
  });

  it("clear empties the queue", () => {
    const q = new SteeringQueue();
    q.enqueue("a");
    q.enqueue("b");
    q.clear();
    assert.equal(q.length, 0);
    assert.equal(q.dequeue(), undefined);
  });
});
