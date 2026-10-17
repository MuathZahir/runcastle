import type { DriveCallResult, FilledHttpRequest } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { activeDriveInfo } from './git'
import { getProjectById } from './repo'

/**
 * Sending an API scenario's call over the live drive (drive-scenarios decision
 * 11): one server-side path shared by the human's Try it and a review agent's
 * `try_call`. Sent from the server, so CORS never applies and any API works.
 * Reads nothing back into state and emits nothing — a call is not a change.
 */

/** How long a call may take before it is abandoned. */
export const DRIVE_CALL_TIMEOUT_MS = 30_000

/** The largest response body kept (256K characters); anything past it is cut and marked truncated. */
export const DRIVE_CALL_BODY_CAP = 256 * 1024

export interface SendDriveCallOptions {
  /** Also admit a review agent's drive (the `review_drive` tool's `try_call`). */
  allowReview?: boolean
  /** Injected in tests; production uses the global `fetch`. */
  fetchFn?: typeof fetch
}

const errorResult = (error: string): DriveCallResult => ({ ok: false, error })

/**
 * Send `request` to the project's live drive and return the response, body
 * capped at {@link DRIVE_CALL_BODY_CAP}. Only the drive's own origin is
 * reachable. Never throws: no drive, a foreign origin, a bad URL, a refused
 * connection and a timeout all come back as `{ ok: false, error }`.
 */
export async function sendDriveCall(
  ctx: AppCtx,
  projectId: string,
  request: FilledHttpRequest,
  opts: SendDriveCallOptions = {},
): Promise<DriveCallResult> {
  const drive = activeDriveInfo(projectId)
  const admitted =
    !!drive &&
    !!getProjectById(ctx, projectId) &&
    (drive.projectDrive === true ||
      drive.purpose === 'human' ||
      (opts.allowReview === true && drive.purpose === 'review'))
  if (!admitted || !drive.devUrl) return errorResult('No running drive with an app URL to send the call to')

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return errorResult(`Not a URL: ${request.url}`)
  }
  if (url.origin !== new URL(drive.devUrl).origin) {
    return errorResult(`${url.origin} is not the drive's app (${new URL(drive.devUrl).origin})`)
  }

  const fetchFn = opts.fetchFn ?? fetch
  const started = performance.now()
  try {
    const res = await fetchFn(url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(DRIVE_CALL_TIMEOUT_MS),
    })
    const text = await res.text()
    const durationMs = Math.round(performance.now() - started)
    const truncated = text.length > DRIVE_CALL_BODY_CAP
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      durationMs,
      headers: [...res.headers.entries()],
      body: truncated ? text.slice(0, DRIVE_CALL_BODY_CAP) : text,
      truncated,
    }
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err))
  }
}
