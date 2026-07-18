/**
 * Server runtime facts the tRPC surface does not expose (`RuncastleConfig` is
 * server-only; `project.list` returns no sandbox). These mirror the
 * `RuncastleConfig` defaults in packages/core/src/config.ts so the status bar
 * can name the sandbox. The model is no longer a hardcoded constant — it is read
 * from `settings.get` at the point of use (issue #48). If the server config ever
 * gets a `config.get` field, read it there instead of these constants.
 */
export const SANDBOX_MODE = 'docker'
export const SERVER_PORT = 4512
