import { spawnSync } from 'node:child_process'

/**
 * Who burns run as — the one answer to that question (feature
 * `burns-work-for-any-linux-user`, decisions 1 and 2).
 *
 * Four things have to agree on it: the `AGENT_UID`/`AGENT_GID` the image is
 * built with, the owner of the burn cache volume, the container's `--user`, and
 * what the doctor holds them to. They used to answer separately: the build read
 * the host while the cache chown hardcoded 1000, so every host whose UID was not
 * 1000 got a cache volume its own burns could not write to.
 */
export interface BurnUser {
  uid: number
  gid: number
  /**
   * Where `gid` came from. `process` means the account lookup failed and the
   * process's own group was used, which `sg docker` and `newgrp` can change, so
   * the doctor says so. `default` means the host has no POSIX ids at all.
   */
  gidSource: 'account' | 'process' | 'default'
}

/** The UID and GID the stock Dockerfile defaults to, and the host-less answer. */
export const DEFAULT_BURN_ID = 1000

/** The host's ids, injected so every branch is testable on any platform. */
export interface HostIdentity {
  /** `process.getuid()`; absent on Windows. */
  uid?: number | undefined
  /** `process.getgid()`; absent on Windows. */
  gid?: number | undefined
  /** The primary group in the account database, or undefined if unreadable. */
  accountGid?: () => number | undefined
}

function runId(args: string[]): string | undefined {
  const out = spawnSync('id', args, { encoding: 'utf8', windowsHide: true })
  if (out.error || out.status !== 0) return undefined
  const value = out.stdout.trim()
  return value === '' ? undefined : value
}

/**
 * The account's primary group, asked BY NAME. Plain `id -g` reports the process's
 * group, which is the value `sg docker` moved; naming the user makes `id` read
 * the account database instead. `process.getgid()` and `os.userInfo().gid` are
 * no use for the same reason.
 */
function lookUpAccountGid(): number | undefined {
  const name = runId(['-un'])
  if (name === undefined) return undefined
  const gid = Number(runId(['-g', name]))
  return Number.isInteger(gid) && gid >= 0 ? gid : undefined
}

let accountGidMemo: { gid: number | undefined } | undefined

/** One process-wide lookup: an account's primary group does not change under it. */
function systemHostIdentity(): HostIdentity {
  return {
    uid: process.getuid?.(),
    gid: process.getgid?.(),
    accountGid: () => (accountGidMemo ??= { gid: lookUpAccountGid() }).gid,
  }
}

/**
 * Resolve the burn user for an engine.
 *
 * Podman is always 1000: rootless podman maps the host's user onto 1000 inside
 * the container, and its image is built with no host ids at all (decision 10).
 * A host with no POSIX ids (Windows) is 1000 as well, which matches the
 * Dockerfile's defaults. Everywhere else it is the host's UID and the account's
 * primary group.
 */
export function resolveBurnUser(
  engine: 'docker' | 'podman',
  host: HostIdentity = systemHostIdentity(),
): BurnUser {
  const fallback: BurnUser = { uid: DEFAULT_BURN_ID, gid: DEFAULT_BURN_ID, gidSource: 'default' }
  if (engine === 'podman' || host.uid === undefined) return fallback
  const accountGid = host.accountGid?.()
  if (accountGid !== undefined) return { uid: host.uid, gid: accountGid, gidSource: 'account' }
  if (host.gid !== undefined) return { uid: host.uid, gid: host.gid, gidSource: 'process' }
  return { ...fallback, uid: host.uid }
}

/** The `uid:gid` form `--user` and `chown` both take. */
export function burnUserSpec(user: Pick<BurnUser, 'uid' | 'gid'>): string {
  return `${user.uid}:${user.gid}`
}

/** Runcastle is running as root. `host` is injected for tests. */
export function runningAsRoot(host: HostIdentity = systemHostIdentity()): boolean {
  return host.uid === 0
}

/** Why a root host cannot burn on Claude Code, and the way out (decision 9). */
export const ROOT_BURN_REFUSED =
  'Runcastle is running as root, and Claude Code refuses to run unattended as root. Run runcastle as a normal user.'
