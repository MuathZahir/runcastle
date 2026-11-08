import type { FileChange, ShownFile, ThreadItem, ToolCall } from '../src/lib/chat-thread'

/**
 * Sample turns for every-word-the-agent-writes-stays-in-view: what the fold
 * will hand the chat once every stretch of the agent's words is its own
 * message and each run of work between them is its own fold. All sample data.
 */

const call = (over: Partial<ToolCall> & Pick<ToolCall, 'id' | 'kind' | 'title'>): ToolCall => ({ status: 'completed', ...over })

const DOC_DIFF: ToolCall['diff'] = {
  path: 'src/server/note-document.tsx',
  lines: [
    { op: ' ', text: "import { Document, Page, Text, View } from '@react-pdf/renderer'" },
    { op: '+', text: "import { toBlocks } from './markdown-blocks'" },
    { op: ' ', text: '' },
    { op: ' ', text: 'export function NoteDocument({ note }: { note: Note }) {' },
    { op: '-', text: '  return <Page><Text>{note.body}</Text></Page>' },
    { op: '+', text: '  return <Page size="A4">{toBlocks(note.body).map(renderBlock)}</Page>' },
    { op: ' ', text: '}' },
  ],
}

const TEST_DIFF: ToolCall['diff'] = {
  path: 'src/server/export.test.ts',
  lines: [
    { op: '-', text: '  expect(pageCount(pdf)).toBe(3)' },
    { op: '+', text: '  expect(pageCount(pdf)).toBe(expectedPages(longNote))' },
  ],
}

const CHANGES: FileChange[] = [
  { path: 'src/server/note-document.tsx', added: 27, removed: 4, lines: DOC_DIFF.lines },
  { path: 'src/server/markdown-blocks.ts', added: 41, removed: 0, lines: [{ op: '+', text: 'export function toBlocks(md: string) {' }] },
  { path: 'src/server/export.test.ts', added: 2, removed: 1, lines: TEST_DIFF.lines },
]

/** A PDF page, drawn inline so the page fetches nothing. */
const PAGE_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300"><rect width="640" height="300" fill="#f4f4f2"/><rect x="40" y="24" width="560" height="276" fill="#fff" stroke="#ddd"/><rect x="72" y="52" width="220" height="16" rx="2" fill="#222"/><rect x="72" y="84" width="460" height="8" rx="2" fill="#999"/><rect x="72" y="100" width="420" height="8" rx="2" fill="#999"/><rect x="72" y="126" width="160" height="12" rx="2" fill="#444"/><rect x="72" y="150" width="496" height="74" rx="4" fill="#eef0f3"/><rect x="88" y="166" width="260" height="7" rx="2" fill="#6b7280"/><rect x="88" y="182" width="320" height="7" rx="2" fill="#6b7280"/><rect x="88" y="198" width="200" height="7" rx="2" fill="#6b7280"/><rect x="72" y="244" width="440" height="8" rx="2" fill="#999"/></svg>`,
)}`

const SHOWN: ShownFile = {
  id: 'f1',
  src: PAGE_SVG,
  name: 'sample-note.png',
  path: 'tmp/sample-note.png',
  size: 48_210,
  as: 'image',
  caption: 'Page 1 of the sample note: a heading, a paragraph and a code block',
}

const OPENING: ThreadItem[] = [
  {
    kind: 'user',
    id: 'u1',
    text: 'Can notes keep their headings and code blocks in the PDF? Right now everything comes out as one paragraph.',
  },
]

/** The turn up to its third run of work, which is where the live state stops. */
const FIRST_HALF: ThreadItem[] = [
  {
    kind: 'work',
    id: 'w1',
    seconds: 38,
    steps: [
      { kind: 'thought', id: 'th1', seconds: 6, text: 'The body probably goes straight into one Text node. Check NoteDocument and how the web app renders Markdown.' },
      {
        kind: 'subagent',
        id: 's1',
        title: 'Find how the web app renders Markdown',
        status: 'completed',
        calls: [call({ id: 's1a', kind: 'search', title: 'react-markdown' }), call({ id: 's1b', kind: 'read', title: 'src/app/Markdown.tsx' })],
      },
      {
        kind: 'tools',
        id: 't1',
        calls: [call({ id: 'c1', kind: 'read', title: 'src/server/export.ts' }), call({ id: 'c2', kind: 'read', title: 'src/server/note-document.tsx' })],
      },
    ],
  },
  {
    kind: 'agent',
    id: 'a1',
    model: 'Opus 5.5',
    text:
      'The PDF flattens the note because `NoteDocument` renders the whole body as one `<Text>`: the Markdown is never parsed.\n\n' +
      'The web app renders Markdown with `react-markdown`, which only targets HTML, so I will parse with `mdast` on the server and map each block to a PDF component myself.',
  },
  {
    kind: 'work',
    id: 'w2',
    seconds: 72,
    steps: [
      {
        kind: 'tools',
        id: 't2',
        calls: [
          call({ id: 'c3', kind: 'edit', title: 'src/server/markdown-blocks.ts', diff: { path: 'src/server/markdown-blocks.ts', lines: [{ op: '+', text: 'export function toBlocks(md: string) {' }] } }),
          call({ id: 'c4', kind: 'edit', title: 'src/server/note-document.tsx', diff: DOC_DIFF }),
        ],
      },
    ],
  },
  { kind: 'agent', id: 'a2', model: 'Opus 5.5', text: 'Fixes in; running the full test suite.' },
]

/** A finished turn: four stretches of words, the work folded between them, a picture shown where it was shown. */
export const SETTLED: ThreadItem[] = [
  ...OPENING,
  ...FIRST_HALF,
  {
    kind: 'work',
    id: 'w3',
    seconds: 46,
    steps: [
      {
        kind: 'tools',
        id: 't3',
        calls: [
          call({ id: 'c5', kind: 'execute', title: 'bun run typecheck' }),
          call({ id: 'c6', kind: 'execute', title: 'bun test', status: 'failed', output: '1 failed: export > a long note breaks across pages\n  expected 3, received 4' }),
          call({ id: 'c7', kind: 'edit', title: 'src/server/export.test.ts', diff: TEST_DIFF }),
          call({ id: 'c8', kind: 'execute', title: 'bun test' }),
        ],
      },
    ],
  },
  {
    kind: 'agent',
    id: 'a3',
    model: 'Opus 5.5',
    text:
      'One test failed, and the test was wrong rather than the code: it expected a long note to take exactly 3 pages, but code blocks no longer break across a page, so it now takes 4. ' +
      'I changed it to count the pages from the note itself. The whole suite passes now.',
  },
  {
    kind: 'work',
    id: 'w4',
    seconds: 5,
    steps: [{ kind: 'thought', id: 'th4', seconds: 5, text: 'Render the sample note so the human can see a heading and a code block on a real page.' }],
  },
  { kind: 'agent', id: 'a4', model: 'Opus 5.5', text: 'Here is the sample note exported, with its heading and a code block:' },
  { kind: 'shown', id: 'sh1', files: [SHOWN] },
  {
    kind: 'agent',
    id: 'a5',
    model: 'Opus 5.5',
    turnSeconds: 171,
    text:
      'Headings, code blocks and lists now come through.\n\n' +
      'One thing I did not decide for you: should a long line in a code block wrap, or should the block shrink to fit the page? I would wrap it, because shrinking makes long lines too small to read.',
  },
  { kind: 'changes', id: 'ch1', files: CHANGES },
]

/** The same turn while it runs: earlier runs folded the moment words followed them, the newest run open. */
export const LIVE: ThreadItem[] = [
  ...OPENING,
  ...FIRST_HALF,
  {
    kind: 'work',
    id: 'w3',
    seconds: 0,
    live: true,
    steps: [
      {
        kind: 'tools',
        id: 't3',
        calls: [
          call({ id: 'c5', kind: 'execute', title: 'bun run typecheck' }),
          call({ id: 'c6', kind: 'execute', title: 'bun test', status: 'in_progress' }),
        ],
      },
    ],
  },
]

/** An agent that writes one line before nearly every tool call: a ladder, nothing merged. */
export const LADDER: ThreadItem[] = [
  { kind: 'user', id: 'u1', text: 'Rename `exportNote` to `exportNoteAsPdf` everywhere.' },
  { kind: 'agent', id: 'l1', model: 'Opus 5.5', text: 'Searching for every use.' },
  { kind: 'work', id: 'lw1', seconds: 2, steps: [{ kind: 'tools', id: 'lt1', calls: [call({ id: 'lc1', kind: 'search', title: 'exportNote' })] }] },
  { kind: 'agent', id: 'l2', model: 'Opus 5.5', text: 'Six files use it: three in the server, three in the web app. Renaming the server first.' },
  {
    kind: 'work',
    id: 'lw2',
    seconds: 9,
    steps: [
      {
        kind: 'tools',
        id: 'lt2',
        calls: [
          call({ id: 'lc2', kind: 'edit', title: 'src/server/export.ts', diff: { path: 'src/server/export.ts', lines: [{ op: '-', text: 'export async function exportNote(' }, { op: '+', text: 'export async function exportNoteAsPdf(' }] } }),
          call({ id: 'lc3', kind: 'edit', title: 'src/server/routes.ts', diff: { path: 'src/server/routes.ts', lines: [{ op: '-', text: '  exportNote,' }, { op: '+', text: '  exportNoteAsPdf,' }] } }),
          call({ id: 'lc4', kind: 'edit', title: 'src/server/export.test.ts', diff: { path: 'src/server/export.test.ts', lines: [{ op: '-', text: 'exportNote(' }, { op: '+', text: 'exportNoteAsPdf(' }] } }),
        ],
      },
    ],
  },
  { kind: 'agent', id: 'l3', model: 'Opus 5.5', text: 'Now the web app.' },
  {
    kind: 'work',
    id: 'lw3',
    seconds: 7,
    steps: [
      {
        kind: 'tools',
        id: 'lt3',
        calls: [
          call({ id: 'lc5', kind: 'edit', title: 'src/app/NoteMenu.tsx', diff: { path: 'src/app/NoteMenu.tsx', lines: [{ op: '-', text: 'exportNote' }, { op: '+', text: 'exportNoteAsPdf' }] } }),
          call({ id: 'lc6', kind: 'edit', title: 'src/app/api.ts', diff: { path: 'src/app/api.ts', lines: [{ op: '-', text: 'exportNote' }, { op: '+', text: 'exportNoteAsPdf' }] } }),
          call({ id: 'lc7', kind: 'edit', title: 'src/app/NoteView.tsx', diff: { path: 'src/app/NoteView.tsx', lines: [{ op: '-', text: 'exportNote' }, { op: '+', text: 'exportNoteAsPdf' }] } }),
        ],
      },
    ],
  },
  { kind: 'agent', id: 'l4', model: 'Opus 5.5', text: 'Running the typecheck.' },
  { kind: 'work', id: 'lw4', seconds: 14, steps: [{ kind: 'tools', id: 'lt4', calls: [call({ id: 'lc8', kind: 'execute', title: 'bun run typecheck' })] }] },
  { kind: 'agent', id: 'l5', model: 'Opus 5.5', text: 'Typecheck passes. Running the export tests.' },
  { kind: 'work', id: 'lw5', seconds: 21, steps: [{ kind: 'tools', id: 'lt5', calls: [call({ id: 'lc9', kind: 'execute', title: 'bun test src/server/export.test.ts' })] }] },
  { kind: 'agent', id: 'l6', model: 'Opus 5.5', turnSeconds: 58, text: 'Renamed in all six files; the typecheck and the export tests pass.' },
  {
    kind: 'changes',
    id: 'lch',
    files: ['src/server/export.ts', 'src/server/routes.ts', 'src/server/export.test.ts', 'src/app/NoteMenu.tsx', 'src/app/api.ts', 'src/app/NoteView.tsx'].map((path) => ({
      path,
      added: 1,
      removed: 1,
      lines: [{ op: '-' as const, text: 'exportNote' }, { op: '+' as const, text: 'exportNoteAsPdf' }],
    })),
  },
]
