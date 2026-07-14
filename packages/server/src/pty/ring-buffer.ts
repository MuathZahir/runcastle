/**
 * Bounded scrollback buffer for a single PTY (UI-SPEC §5). Holds the most recent
 * ~512 KiB of raw terminal output so a freshly-attached WebSocket can replay the
 * session before switching to the live stream. Data is stored as opaque byte
 * chunks (a PTY's output is a UTF-8 stream that may split a multi-byte codepoint
 * across chunk boundaries — xterm's decoder reassembles it, so we never decode
 * here) and evicted oldest-first once the cap is exceeded.
 */

const DEFAULT_CAPACITY = 512 * 1024

export class RingBuffer {
  private chunks: Buffer[] = []
  private bytes = 0

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  /** Append a chunk, evicting the oldest chunks while over capacity. */
  push(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.bytes += chunk.length
    // Keep at least the newest chunk even if it alone exceeds the cap, so a
    // single huge burst is never dropped wholesale.
    while (this.bytes > this.capacity && this.chunks.length > 1) {
      const removed = this.chunks.shift()
      if (removed) this.bytes -= removed.length
    }
  }

  /** The current scrollback as one contiguous buffer (replay payload). */
  snapshot(): Buffer {
    return this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
  }

  /** Total buffered bytes (≤ capacity, modulo the single-oversized-chunk case). */
  get byteLength(): number {
    return this.bytes
  }

  clear(): void {
    this.chunks = []
    this.bytes = 0
  }
}
