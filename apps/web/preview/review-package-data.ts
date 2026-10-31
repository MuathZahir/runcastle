import type { PackageCall, PackageGroup, ReviewPackage } from '@runcastle/core'

/** Sample data for a review package: every picture, call and finding below is made up. */

/** A made-up screenshot of a notes app, at a desktop's proportions. */
function picture(heading: string, accent: string, rows: number, dialog = false): string {
  const lines = Array.from({ length: rows }, (_, i) => {
    const y = 214 + i * 92
    return `<rect x="352" y="${y}" width="1000" height="72" rx="10" fill="#1a1e27"/><rect x="376" y="${y + 18}" width="${420 - i * 40}" height="14" rx="4" fill="#3a4150"/><rect x="376" y="${y + 42}" width="${640 - i * 60}" height="10" rx="4" fill="#2a303c"/>`
  }).join('')
  const panel = dialog
    ? `<rect width="1440" height="900" fill="#000" opacity=".45"/><rect x="460" y="230" width="520" height="420" rx="14" fill="#1d2230"/><rect x="500" y="276" width="220" height="20" rx="5" fill="#eceef4"/><rect x="500" y="330" width="440" height="44" rx="8" fill="#12151c"/><rect x="500" y="392" width="440" height="44" rx="8" fill="#12151c"/><rect x="780" y="572" width="160" height="44" rx="8" fill="${accent}"/>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
<rect width="1440" height="900" fill="#12151c"/>
<rect width="288" height="900" fill="#0d1016"/>
<rect x="32" y="36" width="140" height="18" rx="4" fill="#3a4150"/>
<rect x="24" y="92" width="240" height="40" rx="8" fill="#1a1e27"/>
<rect x="40" y="162" width="160" height="12" rx="3" fill="#2a303c"/>
<rect x="40" y="202" width="130" height="12" rx="3" fill="#2a303c"/>
<text x="352" y="118" fill="#eceef4" font-family="system-ui, sans-serif" font-size="40" font-weight="600">${heading}</text>
<rect x="1192" y="84" width="160" height="48" rx="8" fill="${accent}"/>
${lines}${panel}
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

let next = 1
const shot = (heading: string, accent: string, rows: number, caption: string, dialog = false) => ({
  id: `shot_${next++}`,
  src: picture(heading, accent, rows, dialog),
  caption,
})

const OK_CALL: PackageCall = {
  id: 'call_1',
  method: 'POST',
  url: '/api/notes/18/export',
  headers: [
    ['content-type', 'application/json'],
    ['authorization', '•••'],
  ],
  body: '{"format":"pdf","pageSize":"a4"}',
  result: {
    ok: true,
    status: 201,
    statusText: 'Created',
    durationMs: 84,
    headers: [
      ['content-type', 'application/json'],
      ['set-cookie', '•••'],
    ],
    body: '{"id":"exp_41","pages":3,"url":"/exports/exp_41.pdf"}',
    truncated: false,
  },
}

const REFUSED_CALL: PackageCall = {
  id: 'call_2',
  method: 'POST',
  url: '/api/notes/19/export',
  headers: [['content-type', 'application/json']],
  body: '{"format":"docx"}',
  result: {
    ok: true,
    status: 422,
    statusText: 'Unprocessable Content',
    durationMs: 12,
    headers: [['content-type', 'application/json']],
    body: '{"error":"format not supported"}',
    truncated: false,
  },
}

const GROUPS: PackageGroup[] = [
  {
    id: 'g1',
    name: 'A note with a table',
    shots: [
      shot('Trip budget', '#7ea6ff', 4, 'The note before exporting'),
      shot('Export', '#7ea6ff', 2, 'The dialog keeps the note’s title and offers PDF', true),
      shot('Exported', '#5fbf8f', 3, 'The table fits the page width at A4'),
    ],
    calls: [OK_CALL, REFUSED_CALL],
  },
  {
    id: 'g2',
    name: 'An empty note',
    shots: [shot('Untitled', '#e0b354', 1, 'Export is off, with a line saying why')],
    calls: [],
  },
  {
    id: 'g3',
    name: 'A note shared by someone else',
    failure: 'it exited 1: no such user “guest”',
    shots: [],
    calls: [],
  },
  {
    id: 'g4',
    name: 'Other checks',
    shots: [
      shot('Settings', '#7ea6ff', 3, 'The default page size shows in Settings'),
      shot('History', '#7ea6ff', 4, 'The export is listed in the note’s history'),
    ],
    calls: [],
  },
]

const DRIVEN: ReviewPackage = {
  ticketId: 'tkt_review',
  featureId: 'feat_export',
  seq: 7,
  round: 2,
  passKind: 'review',
  verdict: 'Notes export to PDF with their tables and headings intact. 1 defect found.',
  account:
    'Export notes as PDF now works from a note, keeping its headings, lists and tables. The export dialog opens with the note’s title and the page size from Settings. An empty note cannot be exported and says why. Long tables run past the page edge at A5, which is the one defect. All three checks passed on this build.',
  commitsSince: 0,
  hasWalkthrough: true,
  groups: GROUPS,
  findings: [
    {
      id: 'f1',
      kind: 'defect',
      severity: 'high',
      title: 'A long table runs past the page edge at A5',
      location: 'Export dialog, then the exported PDF',
      citation: 'Spec: “tables fit the page at every paper size”',
      detail: 'I exported the Trip budget note at A5. The table’s last two columns are cut off at the right edge of the page. At A4 the same table fits.',
      reproStep: 'Open Trip budget, press Export, pick A5, press Export, open the PDF.',
    },
    {
      id: 'f2',
      kind: 'observation',
      severity: 'low',
      title: 'No scenario reaches a note shared by someone else',
      location: '.runcastle/scenarios/notes/shared-note.ts',
      citation: 'Acceptance criterion 4',
      detail: 'The scenario failed before it landed, so I could not check exporting a shared note.',
      reproStep: '',
    },
  ],
  empty: null,
}

export type StateKey = 'driven' | 'no-pictures' | 'gates'

export const STATES: Record<StateKey, { label: string; pack: ReviewPackage }> = {
  driven: { label: 'A full package', pack: DRIVEN },
  'no-pictures': {
    label: 'Drove, took no pictures',
    pack: { ...DRIVEN, verdict: 'Notes export to PDF. No defects found.', groups: [], findings: [], empty: 'The review took no screenshots.' },
  },
  gates: {
    label: 'Read the code',
    pack: {
      ...DRIVEN,
      verdict: 'The prompts and docs match the spec. No defects found.',
      hasWalkthrough: false,
      groups: [],
      findings: [],
      empty: 'This review read the code, so it has no screenshots.',
    },
  },
}
