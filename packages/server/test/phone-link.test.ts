import { RuncastleConfig } from '@runcastle/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import type { ExecFn } from '../src/doctor/doctor'
import { listByProject } from '../src/services/events'
import {
  LINUX_OPERATOR_HINT,
  phoneDesignPort,
  phoneLinkStatus,
  turnPhoneLinkOff,
  turnPhoneLinkOn,
} from '../src/services/phone-link'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedProject } from './helpers/fixtures'

/**
 * The phone link (runcastle-on-your-phone, decision 6). The sandbox has no
 * Tailscale, so the CLI is a fake that keeps a serve config the way the real
 * one does: `serve --bg --https=<port>` adds the port, `serve --https=<port>
 * off` removes it, `serve status --json` lists them under `TCP`.
 *
 * The service is driven through its injected runner; the router reaches for the
 * real `createSystemExec`, so for it `node:child_process` is mocked and answers
 * from the same fake — the spawn boundary is the only thing standing in for a
 * machine that has Tailscale on it.
 */

interface FakeTailscale {
  /** Not on this machine: every spawn fails as ENOENT would. */
  installed: boolean
  /** Only answers at this path (Windows' installer dir), not by name. */
  onlyAt?: string
  backend: 'Running' | 'Stopped'
  /** What this machine already serves; 443 is the plain address's slot. */
  served: Set<number>
  /** A port whose serve fails, and with what the CLI says. */
  refuse?: { port: number; stderr: string }
  /** Every command issued, as `[binary, ...args]`. */
  calls: string[][]
}

let tailscale: FakeTailscale

const DNS_NAME = 'desktop-mmp9qrd.tail69a80a.ts.net.'

function answer(args: string[]): { code: number; stdout: string; stderr: string } {
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
  if (args[0] === 'status') {
    return ok(JSON.stringify({ BackendState: tailscale.backend, Self: { DNSName: DNS_NAME } }))
  }
  if (args[0] === 'serve' && args[1] === 'status') {
    const TCP = Object.fromEntries([...tailscale.served].map((p) => [String(p), { HTTPS: true }]))
    return ok(JSON.stringify(tailscale.served.size > 0 ? { TCP } : {}))
  }
  const port = Number(args.find((a) => a.startsWith('--https='))?.slice('--https='.length))
  if (args.at(-1) === 'off') {
    if (!tailscale.served.has(port)) return { code: 1, stdout: '', stderr: 'handler does not exist' }
    tailscale.served.delete(port)
    return ok()
  }
  if (tailscale.refuse?.port === port) return { code: 1, stdout: '', stderr: tailscale.refuse.stderr }
  tailscale.served.add(port)
  return ok()
}

const fakeExec: ExecFn = async (command, args) => {
  tailscale.calls.push([command, ...args])
  const reachable = tailscale.installed && (!tailscale.onlyAt || command === tailscale.onlyAt)
  if (!reachable) return { ok: false, code: null, stdout: '', stderr: 'spawn ENOENT' }
  return { ok: true, ...answer(args) }
}

vi.mock('node:child_process', async (importOriginal) => {
  const { EventEmitter } = await import('node:events')
  const spawn = (file: string, args: string[]) => {
    tailscale.calls.push([file, ...args])
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })
    const reply = answer(args)
    queueMicrotask(() => {
      if (reply.stdout) child.stdout.emit('data', Buffer.from(reply.stdout))
      if (reply.stderr) child.stderr.emit('data', Buffer.from(reply.stderr))
      child.emit('close', reply.code)
    })
    return child
  }
  return { ...(await importOriginal<object>()), spawn }
})

const config = RuncastleConfig.parse({})
const linux = { exec: fakeExec, platform: 'linux' as const }
const APP = config.serverPort
const DESIGN = config.serverPort + 2

/** The commands that changed the serve config, without the binary. */
const serveChanges = () =>
  tailscale.calls.map((c) => c.slice(1)).filter((args) => args[0] === 'serve' && args[1] !== 'status')

beforeEach(() => {
  tailscale = { installed: true, backend: 'Running', served: new Set([443]), calls: [] }
})

describe('phone link status', () => {
  it('reports missing when the tailscale CLI cannot be run', async () => {
    tailscale.installed = false
    const status = await phoneLinkStatus(config, linux)
    expect(status).toMatchObject({ tailscale: 'missing', on: false })
    expect(status.url).toBeUndefined()
    expect(status.commands).toEqual([
      `tailscale serve --bg --https=${APP} http://127.0.0.1:${APP}`,
      `tailscale serve --bg --https=${DESIGN} http://127.0.0.1:${DESIGN}`,
    ])
  })

  it('finds the CLI in Program Files on Windows when it is not on PATH', async () => {
    const installed = 'C:\\Program Files\\Tailscale\\tailscale.exe'
    tailscale.onlyAt = installed
    const status = await phoneLinkStatus(config, { exec: fakeExec, platform: 'win32' })
    expect(status.tailscale).toBe('running')
    expect(status.commands[0]).toBe(
      `"${installed}" serve --bg --https=${APP} http://127.0.0.1:${APP}`,
    )
  })

  it('reports stopped when Tailscale is not running', async () => {
    tailscale.backend = 'Stopped'
    expect(await phoneLinkStatus(config, linux)).toMatchObject({ tailscale: 'stopped', on: false })
  })

  it('reports off with the link built from the machine name, without its trailing dot', async () => {
    expect(await phoneLinkStatus(config, linux)).toMatchObject({
      tailscale: 'running',
      on: false,
      url: 'https://desktop-mmp9qrd.tail69a80a.ts.net:4512',
      designUrl: 'https://desktop-mmp9qrd.tail69a80a.ts.net:4514',
    })
  })

  it('reports on when serve holds the app port', async () => {
    tailscale.served.add(APP)
    expect((await phoneLinkStatus(config, linux)).on).toBe(true)
  })

  it('puts the design pass-through two ports above the server', () => {
    expect(phoneDesignPort(RuncastleConfig.parse({ serverPort: 5000 }))).toBe(5002)
  })
})

describe('turning the phone link on and off', () => {
  it('serves exactly the app port and the design port', async () => {
    const status = await turnPhoneLinkOn(config, linux)
    expect(serveChanges()).toEqual([
      ['serve', '--bg', `--https=${APP}`, `http://127.0.0.1:${APP}`],
      ['serve', '--bg', `--https=${DESIGN}`, `http://127.0.0.1:${DESIGN}`],
    ])
    expect(status).toMatchObject({ on: true })
    expect(status.error).toBeUndefined()
  })

  it('turns off those two ports and leaves what the machine already serves', async () => {
    await turnPhoneLinkOn(config, linux)
    tailscale.calls = []
    const status = await turnPhoneLinkOff(config, linux)
    expect(serveChanges()).toEqual([
      ['serve', `--https=${APP}`, 'off'],
      ['serve', `--https=${DESIGN}`, 'off'],
    ])
    expect(status.on).toBe(false)
    expect([...tailscale.served]).toEqual([443])
  })

  it('never calls funnel and never touches the plain 443 slot', async () => {
    await turnPhoneLinkOn(config, linux)
    await turnPhoneLinkOff(config, linux)
    tailscale.refuse = { port: DESIGN, stderr: 'nope' }
    await turnPhoneLinkOn(config, linux)
    const issued = tailscale.calls.map((c) => c.join(' '))
    expect(issued.length).toBeGreaterThan(0)
    for (const command of issued) {
      expect(command).not.toMatch(/funnel/i)
      expect(command).not.toMatch(/--https=443\b|--https\b(?!=)/)
    }
  })

  it('answers a failure with the CLI message and the commands, leaving nothing half on', async () => {
    tailscale.refuse = { port: DESIGN, stderr: 'Access denied: serve config denied' }
    const status = await turnPhoneLinkOn(config, linux)
    expect(status.error).toBe('Access denied: serve config denied')
    expect(status.on).toBe(false)
    expect([...tailscale.served]).toEqual([443])
    expect(status.commands).toEqual([
      LINUX_OPERATOR_HINT,
      `tailscale serve --bg --https=${APP} http://127.0.0.1:${APP}`,
      `tailscale serve --bg --https=${DESIGN} http://127.0.0.1:${DESIGN}`,
    ])
    expect(LINUX_OPERATOR_HINT).toContain('tailscale set --operator=')
  })

  it('gives no operator hint off Linux', async () => {
    tailscale.refuse = { port: APP, stderr: 'HTTPS is not enabled for your tailnet' }
    const status = await turnPhoneLinkOn(config, { exec: fakeExec, platform: 'win32' })
    expect(status.error).toBe('HTTPS is not enabled for your tailnet')
    expect(status.commands).not.toContain(LINUX_OPERATOR_HINT)
    expect(serveChanges()).toHaveLength(1)
  })
})

describe('phoneLink router', () => {
  let ctx: AppCtx
  let projectId: string
  const caller = () => createCallerFactory(appRouter)(ctx)
  const changes = () =>
    listByProject(ctx, projectId).filter((e) => e.type === 'phone_link.changed')

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
  })

  it('turns the link on and off, answering the fresh status and recording each change', async () => {
    expect((await caller().phoneLink.status()).on).toBe(false)

    const on = await caller().phoneLink.turnOn({ projectId })
    expect(on.on).toBe(true)
    expect(changes()).toHaveLength(1)

    const off = await caller().phoneLink.turnOff({ projectId })
    expect(off.on).toBe(false)
    expect(changes()).toHaveLength(2)
    expect([...tailscale.served]).toEqual([443])
  })

  it('records nothing when turning on fails', async () => {
    tailscale.refuse = { port: APP, stderr: 'denied' }
    const status = await caller().phoneLink.turnOn({ projectId })
    expect(status.error).toBe('denied')
    expect(changes()).toHaveLength(0)
  })

})
