/**
 * Server runtime facts the tRPC surface does not expose (`RuncastleConfig` is
 * server-only; `project.list` returns no sandbox). This mirrors the
 * `RuncastleConfig` default in packages/core/src/config.ts so the status bar
 * can name the sandbox. The model is no longer a hardcoded constant — it is read
 * from `settings.get` at the point of use (issue #48). If the server config ever
 * gets a `config.get` field, read it there instead of this constant.
 *
 * There used to be a `SERVER_PORT = 4512` here too, printed by the status bar's
 * health chip. It was a guess dressed as a measurement: an instance on any
 * other port still read ":4512 ok" (findings F14). The chip says "server ok"
 * now and names the real origin on hover, which nothing can falsify.
 */
export const SANDBOX_MODE = 'docker'
