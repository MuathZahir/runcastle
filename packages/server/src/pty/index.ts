/**
 * Embedded-terminal PTY layer (UI-SPEC §5, owner W1). Public surface:
 * - `createPtySession` — the one backend interface (bun-native node-pty).
 * - `checkPtyInstall` / `assertPtyInstalled` — install-completeness check for the
 *   node-pty native binary (issue #39), consumed by doctor / first-run.
 * - `ptyRegistry` — process-wide live-PTY registry keyed by session id.
 * - `endSession` — kill + mark-ended service backing `feature.endSession`.
 * - `tryUpgradeTerminal` / `terminalWebSocket` — Bun WS wiring for index.ts.
 */
export {
  createPtySession,
  createNativePtySession,
  type CreatePtyOptions,
  type PtySession,
} from './pty'
export {
  assertPtyInstalled,
  checkPtyInstall,
  type PtyInstallProbe,
  type PtyInstallStatus,
} from './install-check'
export { createSidecarPtySession } from './pty-sidecar'
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
