import type { ShownFile, ThreadItem } from '../src/lib/chat-thread'

/** Sample data for shown files: every file below is made up. */

/** A made-up screenshot of a notes app, at a desktop's proportions. */
function screenshot(heading: string, accent: string, rows: number): string {
  const lines = Array.from({ length: rows }, (_, i) => {
    const y = 214 + i * 92
    return `<rect x="352" y="${y}" width="1000" height="72" rx="10" fill="#1a1e27"/><rect x="376" y="${y + 18}" width="${420 - i * 40}" height="14" rx="4" fill="#3a4150"/><rect x="376" y="${y + 42}" width="${640 - i * 60}" height="10" rx="4" fill="#2a303c"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
<rect width="1440" height="900" fill="#12151c"/>
<rect width="288" height="900" fill="#0d1016"/>
<rect x="32" y="36" width="140" height="18" rx="4" fill="#3a4150"/>
<rect x="24" y="92" width="240" height="40" rx="8" fill="#1a1e27"/>
<rect x="40" y="106" width="120" height="12" rx="3" fill="#596075"/>
<rect x="40" y="162" width="160" height="12" rx="3" fill="#2a303c"/>
<rect x="40" y="202" width="130" height="12" rx="3" fill="#2a303c"/>
<rect x="40" y="242" width="170" height="12" rx="3" fill="#2a303c"/>
<text x="352" y="118" fill="#eceef4" font-family="system-ui, sans-serif" font-size="40" font-weight="600">${heading}</text>
<rect x="1192" y="84" width="160" height="48" rx="8" fill="${accent}"/>
<rect x="1224" y="102" width="96" height="12" rx="3" fill="#0a0c11"/>
${lines}
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const dataUrl = (text: string, type: string) => `data:${type};charset=utf-8,${encodeURIComponent(text)}`

const REPORT_MD = `# Export notes as PDF: what changed

The export now keeps a note's **headings, lists and code blocks**.

## What to look at

1. Open a note with a table.
2. Press Export.
3. Check that the table fits the page.

| Note | Pages before | Pages now |
|---|---|---|
| Release plan | 3 | 2 |
| Meeting log | 11 | 9 |

\`\`\`ts
export function toBlocks(md: string) {
  return fromMarkdown(md).children
}
\`\`\`
`

const LOG_TEXT = `$ bun test src/server/export.test.ts
bun test v1.3.1

src/server/export.test.ts:
✓ keeps headings [12.04ms]
✓ keeps lists [3.11ms]
✓ keeps code blocks [4.52ms]
✓ fits a wide table on the page [38.70ms]

 4 pass
 0 fail
 9 expect() calls
Ran 4 tests across 1 file. [71.00ms]
`

const REPORT_HTML = `<!doctype html><html><head><style>
body{font:15px/1.5 system-ui,sans-serif;margin:32px;background:#fff;color:#161a24}
h1{font-size:22px;margin:0 0 12px}.bar{height:14px;background:#3a7ef0;border-radius:4px;margin:6px 0 14px}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid #cdd2de;background:#f4f6f9;cursor:pointer}
</style></head><body>
<h1>Export size report</h1>
<p>Release plan</p><div class="bar" style="width:62%"></div>
<p>Meeting log</p><div class="bar" style="width:84%"></div>
<button onclick="this.textContent='Scripts run, inside the frame'">Press me</button>
</body></html>`

export const IMAGE_ONE: ShownFile = {
  id: 'f1',
  src: screenshot('Export', '#eceef4', 5),
  name: 'export-dialog.png',
  path: '/tmp/shots/export-dialog.png',
  size: 412_000,
  as: 'image',
  caption: 'The export dialog with a long note',
}

export const IMAGE_TWO: ShownFile = {
  id: 'f2',
  src: screenshot('No notes yet', '#46b67a', 1),
  name: 'export-empty.png',
  path: '/tmp/shots/export-empty.png',
  size: 188_000,
  as: 'image',
  caption: 'The empty state, with nothing to export',
}

const MARKDOWN: ShownFile = {
  id: 'f3',
  src: dataUrl(REPORT_MD, 'text/plain'),
  name: 'export-report.md',
  path: 'docs/features/export-notes-as-pdf/export-report.md',
  size: 2_400,
  as: 'markdown',
}

const TEXT: ShownFile = {
  id: 'f4',
  src: dataUrl(LOG_TEXT, 'text/plain'),
  name: 'export-tests.log',
  path: '/tmp/export-tests.log',
  size: 412,
  as: 'text',
  caption: 'The export tests, all green',
}

const HTML: ShownFile = {
  id: 'f5',
  src: dataUrl(REPORT_HTML, 'text/plain'),
  name: 'size-report.html',
  path: 'reports/size-report.html',
  size: 18_200,
  as: 'html',
}

const PDF: ShownFile = {
  id: 'f6',
  src: 'about:blank',
  name: 'sample-note-export.pdf',
  path: 'test/fixtures/sample-note-export.pdf',
  size: 1_840_000,
  as: 'browser',
}

const ARCHIVE: ShownFile = {
  id: 'f7',
  src: 'about:blank',
  name: 'exports.zip',
  path: '/tmp/exports.zip',
  size: 38_400_000,
  as: 'download',
}

const BIG_IMAGE: ShownFile = {
  id: 'f8',
  src: screenshot('Full page', '#eceef4', 6),
  name: 'full-page-capture.png',
  path: '/tmp/shots/full-page-capture.png',
  size: 14_200_000,
  as: 'image',
}

const shot = (n: number, caption: string): ShownFile => ({
  id: `s${n}`,
  src: screenshot(caption, n % 2 ? '#eceef4' : '#4f8ef7', 2 + (n % 4)),
  name: `step-${n}.png`,
  path: `/tmp/shots/step-${n}.png`,
  size: 240_000 + n * 11_000,
  as: 'image',
  caption,
})

const USER: ThreadItem = {
  kind: 'user',
  id: 'u1',
  text: 'Is Export notes as PDF finished? Show me.',
}

const WORK: ThreadItem = {
  kind: 'work',
  id: 'w1',
  seconds: 94,
  steps: [
    { kind: 'tools', id: 't1', calls: [{ id: 'c1', kind: 'other', title: 'read_feature_chat', status: 'completed' }, { id: 'c2', kind: 'other', title: 'show_file', status: 'completed' }, { id: 'c3', kind: 'other', title: 'show_file', status: 'completed' }] },
  ],
}

const answer = (text: string): ThreadItem => ({ kind: 'agent', id: 'a1', text, model: 'Opus 5.5' })

const shown = (files: ShownFile[]): ThreadItem => ({ kind: 'shown', id: 'shown1', files })

/** The states this preview shows, one per address. */
export const STATES = {
  screenshots: {
    label: 'Accepting from the orchestrator',
    items: [USER, WORK, shown([IMAGE_ONE, IMAGE_TWO]), answer('Export notes as PDF is finished: all 4 tickets landed and the checks are green. Merge it?')],
  },
  cards: {
    label: 'Every kind of file',
    items: [
      { ...USER, text: 'What did the export round leave behind?' },
      WORK,
      shown([MARKDOWN, TEXT, HTML, PDF]),
      answer('That is the report, the test log, the size report and a sample export. Open any of them.'),
    ],
  },
  mixed: {
    label: 'Pictures and cards',
    items: [
      { ...USER, text: 'Show me the full page and the raw exports.' },
      WORK,
      shown([IMAGE_ONE, ARCHIVE, BIG_IMAGE]),
      answer('The first capture is inline. The full-page one is 14 MB, so it waits behind its card.'),
    ],
  },
  many: {
    label: 'A long group',
    items: [
      { ...USER, text: 'Walk me through the whole export.' },
      WORK,
      shown([shot(1, 'Open the note'), shot(2, 'Press Export'), shot(3, 'Pick the paper size'), shot(4, 'Export runs'), shot(5, 'The file is ready'), shot(6, 'The saved PDF')]),
      answer('Those are the six steps. Anything off?'),
    ],
  },
  'viewer-image': { label: 'Viewer: a picture', items: [USER, WORK, shown([IMAGE_ONE]), answer('Here it is.')], open: 'export-dialog.png' },
  'viewer-markdown': { label: 'Viewer: Markdown', items: [USER, WORK, shown([MARKDOWN]), answer('Here is the report.')], open: 'export-report.md' },
  'viewer-text': { label: 'Viewer: text', items: [USER, WORK, shown([TEXT]), answer('Here is the log.')], open: 'export-tests.log' },
  'viewer-html': { label: 'Viewer: HTML', items: [USER, WORK, shown([HTML]), answer('Here is the size report.')], open: 'size-report.html' },
} satisfies Record<string, { label: string; items: ThreadItem[]; open?: string }>

export type StateKey = keyof typeof STATES
