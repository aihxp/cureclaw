/**
 * Minimal channel interface for CureClaw.
 * Each channel manages its own message delivery internally.
 */
export interface Channel {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
