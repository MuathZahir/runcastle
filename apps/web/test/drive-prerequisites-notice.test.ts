import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DrivePrerequisitesNotice } from '../src/components/review/DrivePrerequisitesNotice'
import type { DrivePrerequisite } from '../src/lib/api'

/**
 * The review page's standing drive-prerequisite notice: one line naming what
 * this host is missing and what to do, before the next burn — and nothing at
 * all when a drive can be offered.
 */
const FFMPEG: DrivePrerequisite = {
  piece: 'ffmpeg',
  reason: "`ffmpeg` is not on this machine's PATH, so a drive cannot be recorded",
  notice: 'ffmpeg not installed — install it and restart runcastle',
}
const DEV: DrivePrerequisite = {
  piece: 'dev-command',
  reason: 'this project has no dev command configured, so a drive has no app to boot',
  notice: "this project has no dev command — set one in the project's test drive setup",
}

const render = (missing: DrivePrerequisite[]) => renderToStaticMarkup(createElement(DrivePrerequisitesNotice, { missing }))

describe('DrivePrerequisitesNotice', () => {
  it('renders nothing when every drive prerequisite is present', () => {
    expect(render([])).toBe('')
  })

  it('names a missing ffmpeg and what to do about it', () => {
    const html = render([FFMPEG])
    expect(html).toContain('role="status"')
    expect(html).toContain('Walkthrough videos off on this machine: ffmpeg not installed — install it and restart runcastle')
  })

  it('names every missing piece on the one line', () => {
    const html = render([FFMPEG, DEV])
    expect(html).toContain('ffmpeg not installed — install it and restart runcastle; this project has no dev command')
  })
})
