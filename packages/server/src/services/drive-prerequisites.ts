import type { Project } from '@runcastle/core'
import {
  type DriveHostProbe,
  type DrivePiece,
  type MissingDrivePiece,
  missingDrivePieces,
  probeDriveHost,
} from '../workflows/review-ticket'

/**
 * Whether this host can offer a review a drive, read BEFORE a review runs.
 *
 * The review path withholds a drive when a piece is missing and records why
 * (review-as-a-lap-trail decision 8) — but that reason only reaches the trail
 * after a pass has already run Gates. This is the same probe and the same prose
 * ({@link missingDrivePieces}), offered to the review page as a standing notice
 * so the operator can fix the host before the next burn.
 *
 * The host half of the probe spawns `agent-browser --version`, so it is cached
 * for {@link HOST_PROBE_TTL_MS}: the page polls, and a probe per render would be
 * a spawn per render. The dev command is the project's own row, read fresh.
 */

/** How long one host probe answers for. Installing a binary shows up within it. */
export const HOST_PROBE_TTL_MS = 5 * 60_000

/** A missing piece as the operator reads it: the review's prose plus what to do. */
export interface DrivePrerequisite extends MissingDrivePiece {
  /** A short name for the gap and the fix, e.g. "ffmpeg not installed — install it and restart runcastle". */
  notice: string
}

const NOTICE: Record<DrivePiece, string> = {
  'agent-browser': 'agent-browser not installed — install it and restart runcastle',
  'agent-browser-unhealthy': 'agent-browser failed its health check — reinstall it and restart runcastle',
  ffmpeg: 'ffmpeg not installed — install it and restart runcastle',
  'dev-command': "this project has no dev command — set one in the project's test drive setup",
}

export interface DrivePrerequisiteDeps {
  probe?: () => DriveHostProbe
  now?: () => number
}

let cached: { at: number; probe: DriveHostProbe } | undefined

function hostProbe(deps: DrivePrerequisiteDeps): DriveHostProbe {
  const now = (deps.now ?? Date.now)()
  if (!cached || now - cached.at >= HOST_PROBE_TTL_MS) {
    cached = { at: now, probe: (deps.probe ?? probeDriveHost)() }
  }
  return cached.probe
}

/** Every drive prerequisite this host is missing for `project` — empty when a drive can be offered. */
export function drivePrerequisites(
  project: Pick<Project, 'devCommand'>,
  deps: DrivePrerequisiteDeps = {},
): { missing: DrivePrerequisite[] } {
  const { browserPath, browserFailure, ffmpegPath } = hostProbe(deps)
  const missing = missingDrivePieces(browserPath, project.devCommand, browserFailure, ffmpegPath)
  return { missing: missing.map((m) => ({ ...m, notice: NOTICE[m.piece] })) }
}

/** Forget the cached host probe (tests). */
export function resetDrivePrerequisiteCache(): void {
  cached = undefined
}
