/**
 * Embedded-terminal PTY layer (UI-SPEC §5, owner W1). Public surface:
 * - `createPtySession` — the one backend interface (bun-native node-pty).
 * - `ptyRegistry` — process-wide live-PTY registry keyed by session id.
 * - `endSession` — kill + mark-ended service backing `feature.endSession`.
 * - `tryUpgradeTerminal` / `terminalWebSocket` — Bun WS wiring for index.ts.
 */
export { createPtySession, type CreatePtyOptions, type PtySession } from './pty'
export { RingBuffer } from './ring-buffer'
export {
  ptyRegistry,
  type ControlFrame,
  type CreateEntryInput,
  type PtyEntry,
  type TerminalSink,
} from './registry'
export { endSession, type EndSessionResult } from './end-session'
export { terminalWebSocket, tryUpgradeTerminal } from './ws'
