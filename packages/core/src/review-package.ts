import type { DriveCallResult, FilledHttpRequest, ReviewFinding, ScenarioFailure } from './schemas'
import { reviewShotUrl } from './routes'

/**
 * What a review pass saw, and the package it reaches the human as
 * (review-keeps-its-screenshots). The log is one JSON entry per line in the
 * pass's own folder, appended as the pass goes: the file on disk is the record,
 * as with the walkthrough, so a pass that dies keeps what it had.
 */
export type SawEntry =
  | { kind: 'scenario'; at: number; file: string; name: string; ok: true; entryUrl: string }
  | { kind: 'scenario'; at: number; file: string; name: string; ok: false; failure: ScenarioFailure }
  /** `scenario` is the scenario's file; absent when the picture belongs to none. */
  | { kind: 'shot'; at: number; caption: string; image: string; scenario?: string }
  | { kind: 'call'; at: number; scenario: string; request: FilledHttpRequest; result: DriveCallResult }

/** The most pictures one pass keeps, so a runaway loop cannot fill the disk. */
export const SAW_MAX_SHOTS = 60

const MASK = '•••'
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization'])

function maskHeaders(headers: readonly (readonly [string, string])[]): [string, string][] {
  return headers.map(([name, value]) => [name, CREDENTIAL_HEADERS.has(name.toLowerCase()) ? MASK : value])
}

/** A call as it is kept: the request and answer, with credential headers masked. */
export function maskedCall(
  request: FilledHttpRequest,
  result: DriveCallResult,
): { request: FilledHttpRequest; result: DriveCallResult } {
  return {
    request: { ...request, headers: maskHeaders(request.headers) },
    result: result.ok ? { ...result, headers: maskHeaders(result.headers) } : result,
  }
}

export interface PackageShot {
  id: string
  src: string
  caption: string
}

export type PackageCall = FilledHttpRequest & { id: string; result: DriveCallResult }

export interface PackageGroup {
  id: string
  /** The scenario, "Other checks", or null for a pass that ran no scenario. */
  name: string | null
  /** Why the scenario did not land. */
  failure?: string
  shots: PackageShot[]
  calls: PackageCall[]
}

export type PackageFinding = Pick<ReviewFinding, 'id' | 'kind' | 'severity' | 'title' | 'location' | 'citation' | 'detail'> & {
  reproStep: string
}

/** Everything one review pass left, as the card and the page read it. */
export interface ReviewPackage {
  /** The pass's id, which its pictures and walkthrough are kept under: a Review worker's, or an older review ticket's. */
  ticketId: string
  featureId: string
  /** The review ticket's number; null for a Review worker's pass. */
  seq: number | null
  /** The round the pass ran in, when the ticket was part of one. */
  round: number | null
  passKind: 'review' | 'verification'
  /** The first line of the review's own account. */
  verdict: string
  /** The rest of it. */
  account: string
  /** Commits the branch has moved on since the pass; null when that cannot be known. */
  commitsSince: number | null
  hasWalkthrough: boolean
  groups: PackageGroup[]
  findings: PackageFinding[]
  /** Why the pass has no pictures, when it has none. */
  empty: string | null
}

function failureWords(failure: ScenarioFailure): string {
  const last = failure.outputTail.trim().split('\n').at(-1)?.trim()
  const reason =
    failure.reason === 'exit'
      ? `it exited ${failure.exitCode ?? 'with an error'}`
      : failure.reason === 'timeout'
        ? 'it timed out'
        : failure.reason === 'no-runner'
          ? 'this project has no scenario runner'
          : 'it printed no entry page'
  return last ? `${reason}: ${last}` : reason
}

/**
 * The pass's log as the page reads it: one group per scenario in the order they
 * first ran, then the pictures that belong to none. A scenario run twice is one
 * group, and its failure stands only if its latest run failed.
 */
export function packageGroups(ticketId: string, entries: readonly SawEntry[]): PackageGroup[] {
  const groups = new Map<string, PackageGroup>()
  const others: PackageShot[] = []
  const groupOf = (file: string, name = file): PackageGroup => {
    const found = groups.get(file)
    if (found) return found
    const group: PackageGroup = { id: file, name, shots: [], calls: [] }
    groups.set(file, group)
    return group
  }
  entries.forEach((entry, i) => {
    const id = `saw_${i}`
    switch (entry.kind) {
      case 'scenario': {
        const group = groupOf(entry.file, entry.name)
        if (entry.ok) delete group.failure
        else group.failure = failureWords(entry.failure)
        break
      }
      case 'shot': {
        const shot = { id, src: reviewShotUrl(ticketId, entry.image), caption: entry.caption }
        if (entry.scenario) groupOf(entry.scenario).shots.push(shot)
        else others.push(shot)
        break
      }
      case 'call':
        groupOf(entry.scenario).calls.push({ ...entry.request, id, result: entry.result })
        break
    }
  })
  const scenarios = [...groups.values()]
  if (others.length === 0) return scenarios
  return [...scenarios, { id: 'others', name: scenarios.length > 0 ? 'Other checks' : null, shots: others, calls: [] }]
}

/** Defects first, then by severity: the order they are read in. */
export function orderedFindings<T extends Pick<ReviewFinding, 'kind' | 'severity'>>(findings: readonly T[]): T[] {
  const rank = { high: 0, medium: 1, low: 2 } as const
  return [...findings].sort((a, b) => Number(a.kind === 'observation') - Number(b.kind === 'observation') || rank[a.severity] - rank[b.severity])
}

/** The line that says why a pass has no pictures. */
export function noPicturesLine(mode: 'drive' | 'gates' | null, failed: boolean): string {
  if (failed) return 'The review stopped before it took any screenshots.'
  if (mode === 'gates') return 'This review read the code, so it has no screenshots.'
  return 'The review took no screenshots.'
}
