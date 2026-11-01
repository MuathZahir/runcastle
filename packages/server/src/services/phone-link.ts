import { win32 } from 'node:path'
import type { RuncastleConfig } from '@runcastle/core'
import type { ExecFn, ExecOutcome } from '../doctor/doctor'

/**
 * The phone link (runcastle-on-your-phone, decision 6): a private HTTPS address
 * for this machine's runcastle, served by Tailscale onto the human's own
 * tailnet. Everything here wraps the `tailscale` CLI through an injected
 * {@link ExecFn}, so tests fake the CLI's output.
 *
 * Two rules this module exists to keep:
 * - **Only ever `tailscale serve`, never Funnel.** Funnel publishes to the
 *   public internet, and runcastle has no login while its agents run without
 *   permission prompts — anyone who reaches it controls them.
 * - **Only ever our own two ports.** The app is served on HTTPS at the same
 *   port number as `serverPort`, the design pass-through at `serverPort + 2`.
 *   The machine's plain address (the 443 slot) may already serve something
 *   else, so it is never written and never turned off.
 *
 * The server itself keeps listening on 127.0.0.1 only: Tailscale's proxy is
 * the sole way in.
 */

export type TailscaleState = 'missing' | 'stopped' | 'running'

export interface PhoneLinkStatus {
  tailscale: TailscaleState
  /** The serve config holds the app's port. */
  on: boolean
  /** `https://<machine>:<serverPort>` — known whenever Tailscale is running. */
  url?: string
  /** `https://<machine>:<serverPort + 2>`, the design pass-through. */
  designUrl?: string
  /** The exact commands that turn the link on, for the human to run by hand. */
  commands: string[]
  /** What the CLI said when turning the link on or off failed. */
  error?: string
}

export interface PhoneLinkDeps {
  exec: ExecFn
  /** The host's platform; injected in tests. */
  platform?: NodeJS.Platform
}

/** The port the design pass-through listens on, and the phone's Design screen reaches. */
export function phoneDesignPort(config: RuncastleConfig): number {
  return config.serverPort + 2
}

/** The two ports the link serves, app first: the order they are turned on in. */
function linkPorts(config: RuncastleConfig): [number, number] {
  return [config.serverPort, phoneDesignPort(config)]
}

/**
 * Where Windows' installer puts the CLI. A server started before Tailscale was
 * installed, or from a shell whose PATH lacks it, does not find it by name.
 */
const WINDOWS_TAILSCALE = win32.join('C:\\Program Files', 'Tailscale', 'tailscale.exe')

/** What a Linux server needs before a non-root user may change the serve config. */
export const LINUX_OPERATOR_HINT = 'sudo tailscale set --operator=$USER'

const serveOnArgs = (port: number) => [
  'serve',
  '--bg',
  `--https=${port}`,
  `http://127.0.0.1:${port}`,
]
const serveOffArgs = (port: number) => ['serve', `--https=${port}`, 'off']

/** A command as the human would type it, the binary quoted when it is a path. */
function shown(bin: string, args: string[]): string {
  return [bin.includes(' ') ? `"${bin}"` : bin, ...args].join(' ')
}

interface SelfStatus {
  BackendState?: string
  Self?: { DNSName?: string }
}

interface ServeConfig {
  TCP?: Record<string, unknown>
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** The CLI's own words for a failed command, so the human sees what it said. */
function failureMessage(out: ExecOutcome): string {
  const said = [out.stderr.trim(), out.stdout.trim()].filter(Boolean).join('\n')
  return said || `tailscale exited with code ${out.code ?? 'none'}`
}

const succeeded = (out: ExecOutcome): boolean => out.ok && out.code === 0

/** A status, with the binary that answered it and the ports serve holds. */
interface Probe {
  status: PhoneLinkStatus
  bin: string
  served: ReadonlySet<number>
}

/**
 * Find a runnable CLI and read this machine's Tailscale state. `status --self
 * --json` both proves the binary runs and answers whether the daemon is up and
 * what this machine is called; `serve status --json` lists the HTTPS ports
 * served (its `TCP` keys).
 */
async function probe(config: RuncastleConfig, deps: PhoneLinkDeps): Promise<Probe> {
  const [appPort, designPort] = linkPorts(config)
  const platform = deps.platform ?? process.platform
  const candidates = platform === 'win32' ? ['tailscale', WINDOWS_TAILSCALE] : ['tailscale']

  let bin = candidates[0] ?? 'tailscale'
  let self: ExecOutcome | null = null
  for (const candidate of candidates) {
    const out = await deps.exec(candidate, ['status', '--self', '--json'])
    if (!out.ok) continue
    bin = candidate
    self = out
    break
  }
  const commands = [shown(bin, serveOnArgs(appPort)), shown(bin, serveOnArgs(designPort))]
  const none = new Set<number>()
  if (!self) return { bin, served: none, status: { tailscale: 'missing', on: false, commands } }

  const state = parseJson<SelfStatus>(self.stdout)
  // The machine name carries DNS's trailing dot, which a browser address must not.
  const dnsName = state?.Self?.DNSName?.replace(/\.$/, '')
  if (state?.BackendState !== 'Running' || !dnsName) {
    return { bin, served: none, status: { tailscale: 'stopped', on: false, commands } }
  }

  const serve = await deps.exec(bin, ['serve', 'status', '--json'])
  const serveConfig = succeeded(serve) ? parseJson<ServeConfig>(serve.stdout) : null
  const served = new Set(Object.keys(serveConfig?.TCP ?? {}).map(Number))
  return {
    bin,
    served,
    status: {
      tailscale: 'running',
      on: served.has(appPort),
      url: `https://${dnsName}:${appPort}`,
      designUrl: `https://${dnsName}:${designPort}`,
      commands,
    },
  }
}

/** Whether the link is on, its address, and how to turn it on by hand. */
export async function phoneLinkStatus(
  config: RuncastleConfig,
  deps: PhoneLinkDeps,
): Promise<PhoneLinkStatus> {
  return (await probe(config, deps)).status
}

/**
 * Serve the app port, then the design port. A failure turns back off whatever
 * this call turned on, so the link is never left half on, and answers with the
 * CLI's message and the commands to run by hand.
 */
export async function turnPhoneLinkOn(
  config: RuncastleConfig,
  deps: PhoneLinkDeps,
): Promise<PhoneLinkStatus> {
  const { status, bin, served } = await probe(config, deps)
  if (status.tailscale !== 'running') return status

  const turnedOn: number[] = []
  for (const port of linkPorts(config)) {
    if (served.has(port)) continue
    const out = await deps.exec(bin, serveOnArgs(port))
    if (succeeded(out)) {
      turnedOn.push(port)
      continue
    }
    for (const done of turnedOn) await deps.exec(bin, serveOffArgs(done))
    return withFailure(await phoneLinkStatus(config, deps), failureMessage(out), deps)
  }
  return phoneLinkStatus(config, deps)
}

/**
 * Stop serving the link's two ports — and nothing else this machine serves.
 * Only a port serve actually holds is turned off: the CLI refuses to remove a
 * handler that is not there.
 */
export async function turnPhoneLinkOff(
  config: RuncastleConfig,
  deps: PhoneLinkDeps,
): Promise<PhoneLinkStatus> {
  const { status, bin, served } = await probe(config, deps)
  if (status.tailscale !== 'running') return status

  const failures: string[] = []
  for (const port of linkPorts(config)) {
    if (!served.has(port)) continue
    const out = await deps.exec(bin, serveOffArgs(port))
    if (!succeeded(out)) failures.push(failureMessage(out))
  }
  const after = await phoneLinkStatus(config, deps)
  return failures.length > 0 ? withFailure(after, failures.join('\n'), deps) : after
}

/**
 * A status carrying a failed command's message. On Linux the usual cause is a
 * user who is not Tailscale's operator yet, so that fix leads the commands.
 */
function withFailure(status: PhoneLinkStatus, error: string, deps: PhoneLinkDeps): PhoneLinkStatus {
  const linux = (deps.platform ?? process.platform) === 'linux'
  return {
    ...status,
    error,
    commands: linux ? [LINUX_OPERATOR_HINT, ...status.commands] : status.commands,
  }
}
