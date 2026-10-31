import { describe, expect, it } from 'vitest'
import { countEnvKeyLines } from '../src/doctor/afk-env'
import {
  burnCacheVolumeProbe,
  burnUserProbe,
  dockerUserMappingProbe,
  type ExecFn,
  type ExecOutcome,
  RUNTIME_SPECS,
  runtimeAfkKeyProbe,
  runtimeProbes,
} from '../src/doctor/doctor'
import { classifyTokenCheck } from '../src/doctor/token-check'
import {
  describeFreshnessReason,
  imageFreshness,
  imageUidMismatch,
  imageUidMismatchMessage,
  parseImageUser,
} from '../src/services/sandbox-image'
import { BURN_CACHE_VOLUME_LABEL } from '../src/workflows/burn-cache'
import { type BurnUser, resolveBurnUser, runningAsRoot } from '../src/workflows/burn-user'
import {
  burnCacheDeniedMessage,
  buildSandboxOptions,
  classifyTicketRunError,
  errorHeadline,
  imageUidRefusalMessage,
  leadWithCause,
  setupFailureCause,
} from '../src/workflows/ticket-burner'

const VPS_USER: BurnUser = { uid: 1001, gid: 1001, gidSource: 'account' }

/** The real failure from the VPS: the setup chain, then what actually went wrong. */
const SETUP_FAILURE = [
  `Command failed (exit 1): mkdir -p "$HOME/.claude/hooks" "$HOME/.claude" && printf %s '…' | base64 -d > "$HOME/.claude/hooks/burn-guard.sh" && git config --global --add safe.directory '*' && mkdir -p /home/agent/cache/slots/1`,
  `mkdir: cannot create directory '/home/agent/cache/slots': Permission denied`,
].join('\n')

describe('resolveBurnUser', () => {
  it('is the host UID and the account primary group on Docker', () => {
    const host = { uid: 1001, gid: 1001, accountGid: () => 1001 }
    expect(resolveBurnUser('docker', host)).toEqual(VPS_USER)
  })

  // `sg docker` moves the process's group and nothing else. The image and the
  // container must not depend on which shell started runcastle.
  it('reads the account, not the process, so `sg docker` cannot move the group', () => {
    const underSg = { uid: 1001, gid: 998, accountGid: () => 1001 }
    expect(resolveBurnUser('docker', underSg)).toEqual(VPS_USER)
  })

  it('falls back to the process group, and says so, when the lookup fails', () => {
    const host = { uid: 1001, gid: 998, accountGid: () => undefined }
    expect(resolveBurnUser('docker', host)).toEqual({ uid: 1001, gid: 998, gidSource: 'process' })
  })

  it('is 1000:1000 on a host with no ids, as Windows has always been', () => {
    expect(resolveBurnUser('docker', {})).toEqual({ uid: 1000, gid: 1000, gidSource: 'default' })
  })

  // Rootless podman maps the host's user onto 1000 inside the container.
  it('is always 1000:1000 on podman', () => {
    const host = { uid: 1001, gid: 1001, accountGid: () => 1001 }
    expect(resolveBurnUser('podman', host)).toEqual({ uid: 1000, gid: 1000, gidSource: 'default' })
  })

  it('tells root from everyone else', () => {
    expect(runningAsRoot({ uid: 0 })).toBe(true)
    expect(runningAsRoot({ uid: 1001 })).toBe(false)
    expect(runningAsRoot({})).toBe(false)
  })
})

describe('buildSandboxOptions', () => {
  it('passes the burn user to the container, so sandcastle does not read the process', () => {
    const options = buildSandboxOptions({}, null, [], {}, undefined, VPS_USER)
    expect(options).toMatchObject({ containerUid: 1001, containerGid: 1001 })
  })

  it('passes none when no burn user is given, which is how podman keeps its default', () => {
    expect(buildSandboxOptions({}, null)).not.toHaveProperty('containerUid')
  })
})

describe('a failed setup step leads with its cause', () => {
  it('finds the real cause below the command', () => {
    expect(setupFailureCause(SETUP_FAILURE)).toBe(
      `mkdir: cannot create directory '/home/agent/cache/slots': Permission denied`,
    )
    expect(errorHeadline(SETUP_FAILURE)).toBe(setupFailureCause(SETUP_FAILURE))
  })

  it('takes the last failing line: tools report the root problem last', () => {
    const message = 'Command failed (exit 1): bun install\nwarn: deprecated\nerror: first\nfatal: root cause\ndone'
    expect(setupFailureCause(message)).toBe('fatal: root cause')
  })

  it('falls back to the last line of output, and to nothing with no output', () => {
    expect(setupFailureCause('Command failed (exit 1): make\nstep one\nstep two')).toBe('step two')
    expect(setupFailureCause('Command failed (exit 1): make')).toBeUndefined()
  })

  // The ticket row renders `error.split('\n')[0]`, so the first line is the fix.
  it('puts the cause on the first line and loses nothing', () => {
    const led = leadWithCause(SETUP_FAILURE)
    expect(led.split('\n')[0]).toContain('Permission denied')
    expect(led).toContain(SETUP_FAILURE)
    expect(errorHeadline(led)).toBe(led.split('\n')[0])
  })

  it('leaves every other failure as it was', () => {
    expect(leadWithCause('agent made no commits')).toBe('agent made no commits')
    expect(errorHeadline('Preparing worktree\nfatal: Filename too long')).toBe(
      'fatal: Filename too long',
    )
  })

  it('says a cache refusal in plain words, naming the volume and the user', () => {
    const message = burnCacheDeniedMessage(SETUP_FAILURE, 'runcastle-proj_x', VPS_USER)
    expect(errorHeadline(message ?? '')).toBe(
      'Burn cache volume runcastle-proj_x is not writable by burn user 1001:1001. Clear the burn cache in Settings → Workers, then burn again.',
    )
    expect(message).toContain(SETUP_FAILURE)
  })

  it('does not call another path’s refusal a cache problem', () => {
    const other = 'Command failed (exit 1): /home/agent/cache/x.sh\n/opt/tool: Permission denied'
    expect(burnCacheDeniedMessage(other, 'v', VPS_USER)).toBeUndefined()
  })

  // The volume is a machine fact, not an account fact: it must not read as auth.
  it('does not mistake a cache refusal for a credential problem', () => {
    expect(classifyTicketRunError(new Error(SETUP_FAILURE), 'claude-code')).not.toBe('run-fatal')
  })

  it('rewrites sandcastle’s UID refusal, which names a command nobody has', () => {
    const refusal =
      "UID mismatch: image 'sandcastle:runcastle' was built with UID 1000, but the expected UID is 1001. Rebuild the image with 'sandcastle docker build-image'"
    expect(imageUidRefusalMessage(refusal, null)).toBe(
      'Image sandcastle:runcastle was built for UID 1000, but burns on this machine run as UID 1001. Rebuild it from Settings → Workers.',
    )
    expect(imageUidRefusalMessage('some other error', null)).toBeUndefined()
  })
})

describe('the image’s user', () => {
  const built = (user: string | null) => ({
    present: true,
    hash: 'h',
    versions: { 'claude-code': null, codex: null },
    user,
  })
  const NO_CLIS = { 'claude-code': null, codex: null }

  it('reads numeric ids and declines to judge anything else', () => {
    expect(parseImageUser('1001:1001')).toEqual({ uid: 1001, gid: 1001 })
    expect(parseImageUser('1001')).toEqual({ uid: 1001 })
    expect(parseImageUser('agent')).toBeNull()
    expect(parseImageUser('')).toBeNull()
    expect(parseImageUser(null)).toBeNull()
  })

  it('is stale for another UID, so the doctor and Rebuild agree', () => {
    const verdict = imageFreshness({
      image: built('1000:1000'),
      expectedHash: null,
      host: NO_CLIS,
      burnUser: VPS_USER,
    })
    expect(verdict).toEqual({ fresh: false, reasons: [{ kind: 'user', image: 1000, burn: 1001 }] })
    expect(describeFreshnessReason('img', { kind: 'user', image: 1000, burn: 1001 })).toBe(
      'img was built for UID 1000, but burns here run as UID 1001',
    )
  })

  // Burns pass the right group themselves, so this one is cosmetic.
  it('stays fresh for a group-only mismatch, and for a user it cannot read', () => {
    for (const user of ['1001:998', 'agent', null]) {
      const verdict = imageFreshness({
        image: built(user),
        expectedHash: null,
        host: NO_CLIS,
        burnUser: VPS_USER,
      })
      expect(verdict).toEqual({ fresh: true })
    }
  })

  it('never sends a custom image to the Rebuild button that refuses it', () => {
    expect(imageUidMismatch('1000:1000', VPS_USER)).toBe(1000)
    expect(imageUidMismatchMessage('mine', 1000, 1001, true)).toContain('Settings → Workers')
    const custom = imageUidMismatchMessage('mine', 1000, 1001, false)
    expect(custom).not.toContain('Settings')
    expect(custom).toContain('wherever it was made')
  })
})

/** A canned engine; anything unlisted answers ok and empty. */
function engine(reply: (args: string[]) => Partial<ExecOutcome> = () => ({})) {
  const calls: string[][] = []
  const exec: ExecFn = async (_command, args) => {
    calls.push(args)
    return { ok: true, code: 0, stdout: '', stderr: '', ...reply(args) }
  }
  return { exec, calls }
}

const isVolumeInspect = (args: string[]) => args[0] === 'volume' && args[1] === 'inspect'
const isVolumeList = (args: string[]) => args[0] === 'volume' && args[1] === 'ls'
const isRun = (args: string[]) => args[0] === 'run'

describe('the doctor’s burn cache row', () => {
  const scope = { imageName: 'sandcastle:runcastle', projectId: 'proj_a' }

  it('reports a volume the burn user cannot write to, without failing the report', async () => {
    const { exec } = engine((args) => {
      if (isVolumeInspect(args)) return { stdout: '1\n' }
      if (isRun(args)) return { stdout: 'runcastle-access unwritable 0:0 /home/agent/cache\n' }
      return {}
    })
    const row = await burnCacheVolumeProbe(exec, scope, VPS_USER)
    expect(row).toMatchObject({ id: 'burn-cache-volume', status: 'stale', severity: 'info' })
    expect(row?.detail).toContain('burn user 1001:1001 cannot write to')
    expect(row?.detail).toContain('owned by 0:0')
    expect(row?.detail).toContain('next burn replaces it')
  })

  it('is ok when the volume is writable, and when there is no volume yet', async () => {
    const writable = engine((args) => {
      if (isVolumeInspect(args)) return { stdout: '1\n' }
      return isRun(args) ? { stdout: 'runcastle-access writable\n' } : {}
    })
    expect((await burnCacheVolumeProbe(writable.exec, scope, VPS_USER))?.status).toBe('ok')

    const none = engine((args) => (isVolumeInspect(args) ? { code: 1 } : {}))
    expect(await burnCacheVolumeProbe(none.exec, scope, VPS_USER)).toMatchObject({
      status: 'ok',
      detail: expect.stringContaining('no cache volume yet'),
    })
    expect(none.calls.some(isRun)).toBe(false)
  })

  it('says nothing when there is no image to test from', async () => {
    const { exec } = engine((args) => (args[0] === 'image' ? { code: 1 } : {}))
    expect(await burnCacheVolumeProbe(exec, scope, VPS_USER)).toBeUndefined()
  })

  // The CLI has no database, so the engine's labelled volumes are the list.
  it('tests every labelled volume when no project is in view', async () => {
    const { exec, calls } = engine((args) => {
      if (isVolumeList(args)) return { stdout: 'runcastle-proj_a\nruncastle-proj_b\n' }
      return isRun(args) ? { stdout: 'runcastle-access writable\n' } : {}
    })
    await burnCacheVolumeProbe(exec, { imageName: 'img' }, VPS_USER)
    expect(calls.find(isVolumeList)).toContain(`label=${BURN_CACHE_VOLUME_LABEL}`)
    expect(calls.filter(isRun).map((c) => c[c.indexOf('-v') + 1])).toEqual([
      'runcastle-proj_a:/home/agent/cache',
      'runcastle-proj_b:/home/agent/cache',
    ])
  })
})

describe('the burn user row', () => {
  it('names who burns run as', () => {
    expect(burnUserProbe(VPS_USER, false, 'error')).toMatchObject({
      status: 'ok',
      detail: 'burns run as 1001:1001',
    })
  })

  it('refuses root with the reason, and how to get out of it', () => {
    const row = burnUserProbe({ uid: 0, gid: 0, gidSource: 'account' }, true, 'error')
    expect(row).toMatchObject({ status: 'unhealthy', severity: 'error' })
    expect(row.detail).toContain('Claude Code refuses')
    expect(row.fix).toContain('normal user')
  })
})

describe('docker user mapping', () => {
  const info = (stdout: string) => engine(() => ({ stdout })).exec

  it('names rootless Docker and userns-remap', async () => {
    const rootless = await dockerUserMappingProbe(info('["name=seccomp","name=rootless"]'))
    expect(rootless?.detail).toContain('rootless Docker')
    const remapped = await dockerUserMappingProbe(info('["name=userns"]'))
    expect(remapped?.detail).toContain('userns-remap')
  })

  it('has no row for an ordinary engine, or one that will not say', async () => {
    expect(await dockerUserMappingProbe(info('["name=seccomp,profile=builtin"]'))).toBeUndefined()
    expect(await dockerUserMappingProbe(engine(() => ({ code: 1 })).exec)).toBeUndefined()
  })
})

describe('the token row', () => {
  const spec = RUNTIME_SPECS['claude-code']
  const KEY = spec.afkKey

  it('counts every line for a key, comments aside', () => {
    const content = `# ${KEY}=old\n${KEY}=a\nexport ${KEY}=b\n  ${KEY}=c\nOTHER=1\n`
    expect(countEnvKeyLines(content, KEY)).toBe(3)
    expect(countEnvKeyLines(content, 'MISSING')).toBe(0)
  })

  it('reports duplicate lines, saying which one burns use', () => {
    const row = runtimeAfkKeyProbe(spec, { [KEY]: 'tok' }, 'error', { [KEY]: 3 })
    expect(row?.detail).toContain(`has 3 ${KEY} lines, and burns use the last`)
    expect(row?.status).toBe('ok')
  })

  it('says nothing extra about a single line', () => {
    expect(runtimeAfkKeyProbe(spec, { [KEY]: 'tok' }, 'error', { [KEY]: 1 })?.detail).toBe(
      'OAuth token present',
    )
  })

  const afkRow = async (check: () => Promise<import('../src/doctor/token-check').TokenCheck>) => {
    const rows = await runtimeProbes(spec, {
      exec: engine().exec,
      env: { [KEY]: 'tok' },
      severity: 'error',
      checkToken: check,
    })
    return rows.find((r) => r.check === 'afk-key')
  }

  it('fails the row when a live call rejects the token', async () => {
    const row = await afkRow(async () => ({ verdict: 'rejected', why: 'Invalid API key' }))
    expect(row).toMatchObject({ status: 'unhealthy', fix: spec.afkFix })
    expect(row?.detail).toContain('the service rejected it: Invalid API key')
  })

  it('passes it when the call works, and does not blame the token when it cannot run', async () => {
    expect((await afkRow(async () => ({ verdict: 'ok' })))?.detail).toContain('a live call authenticated')
    const row = await afkRow(async () => ({ verdict: 'unreachable', why: 'the call timed out' }))
    expect(row?.status).toBe('ok')
    expect(row?.detail).toContain('not tested: the call timed out')
  })
})

describe('classifyTokenCheck', () => {
  const out = (over: Partial<ExecOutcome>): ExecOutcome => ({
    ok: true,
    code: 1,
    stdout: '',
    stderr: '',
    ...over,
  })

  it('reads a clean exit as authenticated', () => {
    expect(classifyTokenCheck(out({ code: 0, stdout: 'ok' }))).toEqual({ verdict: 'ok' })
  })

  it('reads a refusal as rejected, on either stream', () => {
    expect(classifyTokenCheck(out({ stdout: 'Invalid API key · Please run /login' })).verdict).toBe('rejected')
    expect(classifyTokenCheck(out({ stderr: 'API Error: 401 unauthorized' })).verdict).toBe('rejected')
  })

  // Measured: the CLI's stdin warning came first and hid the actual refusal.
  it('names the refusal, not a warning printed before it', () => {
    const noisy = out({
      stderr: 'Warning: no stdin data received in 3s, proceeding without it.',
      stdout: 'Invalid API key · Please run /login',
    })
    expect(classifyTokenCheck(noisy)).toEqual({
      verdict: 'rejected',
      why: 'Invalid API key · Please run /login',
    })
  })

  it('never blames the token for anything else', () => {
    expect(classifyTokenCheck(out({ ok: false, code: null })).verdict).toBe('unreachable')
    expect(classifyTokenCheck(out({ code: null, timedOut: true })).verdict).toBe('unreachable')
    expect(classifyTokenCheck(out({ stderr: 'getaddrinfo ENOTFOUND api.anthropic.com' })).verdict).toBe(
      'unreachable',
    )
  })
})
