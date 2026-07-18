/**
 * Server runtime facts the tRPC surface does not expose (`RuncastleConfig` is
 * server-only; `project.list` returns no sandbox/model). These mirror the
 * `RuncastleConfig` defaults in packages/core/src/config.ts so the status bar
 * and burn chips can name the sandbox + model. If the server config ever gets a
 * `config.get` field, read it there instead of these constants.
 */
export const SANDBOX_MODE = 'docker'
export const MODEL = 'claude-opus-4-8'
export const SERVER_PORT = 4512
