/**
 * SteeringQueue — FIFO buffer for follow-up prompts.
 * Prompts enqueued while the agent is streaming are auto-fed after completion.
 */
export class SteeringQueue {
  private queue: string[] = [];

  enqueue(prompt: string): void {
    this.queue.push(prompt);
  }

  dequeue(): string | undefined {
    return this.queue.shift();
  }

  drainAll(): string[] {
    const items = this.queue.slice();
    this.queue.length = 0;
    return items;
  }

  get length(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue.length = 0;
  }
}
