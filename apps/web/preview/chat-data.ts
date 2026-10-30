import type {
  Ask,
  Attachment,
  BackgroundTask,
  ContextUsage,
  Effort,
  FileChange,
  ModelChoice,
  PlanEntry,
  Question,
  SlashCommand,
  ThreadEntry,
  ThreadItem,
  ThreadState,
  ToolCall,
  UsageLimit,
} from '../src/lib/chat-thread'

/**
 * One feature, "Export notes as PDF", its chat at each moment the chat column
 * has to show (docs/features/chat-as-web-components).
 */

export const TITLE = 'Export notes as PDF'

const MIN = 60_000
export const NOW = Date.UTC(2026, 9, 26, 14, 0)

/** A made-up Select area crop: a toolbar with a misaligned button. */
const CROP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200" viewBox="0 0 480 200">
<rect width="480" height="200" fill="#1b1f27"/>
<rect x="16" y="16" width="448" height="40" rx="6" fill="#252a34"/>
<rect x="28" y="28" width="120" height="16" rx="3" fill="#3a4150"/>
<rect x="352" y="30" width="96" height="24" rx="6" fill="#e6e9ef"/>
<rect x="364" y="38" width="72" height="8" rx="2" fill="#252a34"/>
<rect x="16" y="72" width="448" height="112" rx="6" fill="#20242d"/>
<rect x="32" y="92" width="300" height="10" rx="2" fill="#3a4150"/>
<rect x="32" y="112" width="360" height="10" rx="2" fill="#30364a"/>
<rect x="32" y="132" width="240" height="10" rx="2" fill="#30364a"/>
<rect x="344" y="22" width="112" height="40" rx="8" fill="none" stroke="#5b8def" stroke-width="2" stroke-dasharray="5 4"/>
</svg>`

export const CROP: Attachment = {
  id: 'crop1',
  name: 'Select area crop',
  src: `data:image/svg+xml;utf8,${encodeURIComponent(CROP_SVG)}`,
}

export const COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Summarise the conversation to free up context' },
  { name: 'context', description: 'What fills the context window' },
  { name: 'cost', description: 'Tokens and cost of this thread' },
  { name: 'usage', description: 'Your plan’s usage limits' },
  { name: 'mcp', description: 'MCP servers and their status' },
  { name: 'review', description: 'Review the current branch' },
  { name: 'runcastle:code-review', description: 'Review the feature branch against its spec' },
  { name: 'simplify', description: 'Review changed code for reuse and simplification' },
]

export const FILES = [
  'src/server/export.ts',
  'src/server/export.test.ts',
  'src/server/note-document.tsx',
  'src/app/NoteToolbar.tsx',
  'src/app/NoteMenu.tsx',
  'docs/features/export-notes-as-pdf/spec.md',
  'docs/features/export-notes-as-pdf/decisions.md',
  'package.json',
]

const EVERY_EFFORT: Effort[] = ['low', 'medium', 'high', 'max']

/** Claude Code's list as claude-agent-acp offers it (Default named as its model), with the operator's notes. */
export const MODELS: ModelChoice[] = [
  { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5', note: '1M context · involved work and UI', efforts: EVERY_EFFORT, fast: true },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'The most capable, for the hardest problems', efforts: EVERY_EFFORT },
  { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1 (1M context)', note: 'Fable 5.1 with a 1M-token context', efforts: EVERY_EFFORT },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Most everyday tasks', efforts: EVERY_EFFORT },
  { id: 'claude-sonnet-5-5[1m]', label: 'Sonnet 5.5 (1M context)', note: 'Sonnet 5.5 with a 1M-token context', efforts: EVERY_EFFORT },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'Quick, mechanical work' },
  { id: 'claude-fable-5', label: 'Fable 5', note: 'The previous Fable' },
  { id: 'claude-opus-5', label: 'Opus 5', note: 'The previous Opus', efforts: EVERY_EFFORT },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

/** Codex's list as codex-acp offers it: `gpt-` ids, named without the prefix. */
export const CODEX_MODELS: ModelChoice[] = [
  { id: 'gpt-5.6-sol', label: '5.6 Sol', note: 'Frontier agentic coding model', efforts: ['low', 'medium', 'high'], fast: true },
  { id: 'gpt-5.6-terra', label: '5.6 Terra', note: 'Balanced speed and depth', efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.6-luna', label: '5.6 Luna', note: 'Fast and inexpensive', efforts: ['low', 'medium'] },
  { id: 'gpt-5.5', label: '5.5', note: 'The previous frontier model', efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.5-mini', label: '5.5 Mini', note: 'Small and quick' },
  { id: 'gpt-5.4', label: '5.4' },
  { id: 'gpt-5.4-mini', label: '5.4 Mini' },
  { id: 'gpt-5.5-codex', label: '5.5 Codex', note: 'Tuned for long coding sessions', efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.3-codex', label: '5.3 Codex' },
]

export const LIMITS: UsageLimit[] = [
  { label: 'Current 5-hour window', percent: 34, resets: '3:40 pm' },
  { label: 'This week', percent: 12, resets: 'Thu 9:00 am' },
  { label: 'This week · Opus', percent: 21, resets: 'Thu 9:00 am' },
]

const call = (over: Partial<ToolCall> & Pick<ToolCall, 'id' | 'kind' | 'title'>): ToolCall => ({
  status: 'completed',
  ...over,
})

const DOC_DIFF: ToolCall['diff'] = {
  path: 'src/server/note-document.tsx',
  lines: [
    { op: ' ', text: "import { Document, Page, Text, View } from '@react-pdf/renderer'" },
    { op: '+', text: "import { fromMarkdown } from 'mdast-util-from-markdown'" },
    { op: ' ', text: '' },
    { op: ' ', text: 'export function NoteDocument({ note }: { note: Note }) {' },
    { op: '-', text: '  return <Page><Text>{note.body}</Text></Page>' },
    { op: '+', text: '  const blocks = fromMarkdown(note.body).children' },
    { op: '+', text: '  return (' },
    { op: '+', text: '    <Page size="A4" style={styles.page}>' },
    { op: '+', text: '      {blocks.map((b, i) => <Block key={i} node={b} />)}' },
    { op: '+', text: '    </Page>' },
    { op: '+', text: '  )' },
    { op: ' ', text: '}' },
  ],
}

const TEST_DIFF: ToolCall['diff'] = {
  path: 'src/server/export.test.ts',
  lines: [
    { op: ' ', text: "it('a long note breaks across pages', async () => {" },
    { op: ' ', text: '  const pdf = await exportNote(longNote.id)' },
    { op: '-', text: '  expect(pageCount(pdf)).toBe(3)' },
    { op: '+', text: '  expect(pageCount(pdf)).toBe(expectedPages(longNote))' },
    { op: ' ', text: '})' },
  ],
}

const CHANGES: FileChange[] = [
  { path: 'src/server/note-document.tsx', added: 27, removed: 4, lines: DOC_DIFF.lines },
  { path: 'src/server/export.test.ts', added: 2, removed: 8, lines: TEST_DIFF.lines },
]

/** The conversation so far, shared by the moments that continue it. */
const HISTORY: ThreadItem[] = [
  {
    kind: 'user',
    id: 'u1',
    text: 'Can notes keep their headings and code blocks in the PDF? Right now everything comes out as one paragraph.',
  },
  {
    kind: 'work',
    id: 'w1',
    seconds: 41,
    steps: [
      { kind: 'thought', id: 'th1', seconds: 6, text: 'The body probably goes straight into one Text node. Check NoteDocument and whether anything parses Markdown on the server.' },
      {
        kind: 'tools',
        id: 't1',
        calls: [
          call({ id: 'c1', kind: 'search', title: 'renderToBuffer' }),
          call({ id: 'c2', kind: 'read', title: 'src/server/export.ts' }),
          call({ id: 'c3', kind: 'read', title: 'src/server/note-document.tsx' }),
          call({ id: 'c4', kind: 'read', title: 'docs/features/export-notes-as-pdf/spec.md' }),
        ],
      },
    ],
  },
  {
    kind: 'agent',
    id: 'a1',
    model: 'Opus 5.5',
    text:
      'The PDF flattens the note because `NoteDocument` renders the body as one `<Text>` — the Markdown is never parsed.\n\n' +
      'I can map the Markdown to PDF blocks instead:\n\n' +
      '- **Headings** keep their level, in the app font at three sizes.\n' +
      '- **Code blocks** use Geist Mono on a light ground, and never break across a page.\n' +
      '- **Lists** keep their bullets and numbers.\n\n' +
      'That is one file and a test. Shall I go ahead?',
  },
  { kind: 'user', id: 'u2', text: 'Yes, go ahead.' },
]

const WORKING: ThreadItem[] = [
  ...HISTORY,
  {
    kind: 'work',
    id: 'w2',
    seconds: 0,
    live: true,
    steps: [
      { kind: 'thought', id: 'th2', seconds: 4, text: 'Parse with mdast, then map each block type to a PDF component.' },
      {
        kind: 'subagent',
        id: 's1',
        title: 'Find how the web app renders Markdown',
        status: 'completed',
        calls: [
          call({ id: 's1a', kind: 'search', title: 'react-markdown' }),
          call({ id: 's1b', kind: 'read', title: 'src/app/Markdown.tsx' }),
        ],
      },
      { kind: 'narration', id: 'n1', text: 'The web side uses `react-markdown`, which only targets HTML. I will parse with `mdast` and map the blocks myself.' },
      {
        kind: 'tools',
        id: 't2',
        calls: [
          call({ id: 'c5', kind: 'edit', title: 'src/server/note-document.tsx', diff: DOC_DIFF }),
          call({ id: 'c5b', kind: 'edit', title: 'src/server/markdown-blocks.ts', diff: { path: 'src/server/markdown-blocks.ts', lines: [{ op: '+', text: 'export function toBlocks(md: string) {' }, { op: '+', text: '  return fromMarkdown(md).children' }, { op: '+', text: '}' }] } }),
          call({ id: 'c5c', kind: 'edit', title: 'src/server/export.ts', diff: { path: 'src/server/export.ts', lines: [{ op: '-', text: '  body: note.body,' }, { op: '+', text: '  body: toBlocks(note.body),' }] } }),
          call({ id: 'c6a', kind: 'execute', title: 'bun run typecheck' }),
          call({ id: 'c6', kind: 'execute', title: 'bun test src/server/export.test.ts', status: 'in_progress' }),
        ],
      },
    ],
  },
]

/** A turn whose subagent is still at work: its call in flight shows under the card's head. */
const SUBAGENT: ThreadItem[] = [
  ...HISTORY,
  {
    kind: 'work',
    id: 'w3',
    seconds: 0,
    live: true,
    steps: [
      { kind: 'thought', id: 'th3', seconds: 3, text: 'Check how the web app already renders Markdown before choosing a parser.' },
      {
        kind: 'subagent',
        id: 's2',
        title: 'Find how the web app renders Markdown',
        status: 'in_progress',
        calls: [
          call({ id: 's2a', kind: 'search', title: 'react-markdown' }),
          call({ id: 's2b', kind: 'read', title: 'src/app/Markdown.tsx' }),
          call({ id: 's2c', kind: 'read', title: 'src/app/NoteView.tsx', status: 'in_progress' }),
        ],
      },
    ],
  },
]

export const PLAN: PlanEntry[] = [
  { content: 'Parse the note body as Markdown', status: 'completed' },
  { content: 'Map headings, lists and code blocks to PDF blocks', status: 'completed' },
  { content: 'Keep code blocks whole across page breaks', status: 'in_progress' },
  { content: 'Update the export tests', status: 'pending' },
  { content: 'Run the full test suite', status: 'pending' },
]

export const TASKS: BackgroundTask[] = [{ id: 'bg1', title: 'bun run dev --port 5173', startedAt: Date.now() - 312_000 }]

const ASKING: ThreadItem[] = [
  ...HISTORY,
  {
    kind: 'work',
    id: 'w3',
    seconds: 18,
    steps: [{ kind: 'tools', id: 't3', calls: [call({ id: 'c7', kind: 'read', title: 'package.json' })] }],
  },
  {
    kind: 'agent',
    id: 'a2',
    text: 'The Markdown parser the app already uses only targets HTML, so I need a small one for the PDF side.',
  },
]

export const APPROVAL: Ask = {
  kind: 'approval',
  id: 'p1',
  call: call({ id: 'c8', kind: 'execute', title: 'bun add mdast-util-from-markdown@2.0.2', status: 'pending' }),
}

export const EDIT_APPROVAL: Ask = {
  kind: 'approval',
  id: 'p2',
  call: call({ id: 'c9', kind: 'edit', title: 'src/server/export.test.ts', status: 'pending', diff: TEST_DIFF }),
}

const PAGE_SIZE: Question = {
  header: 'Page size',
  question: 'Which page size should the PDF use?',
  options: [
    { label: 'A4', description: 'The default almost everywhere outside North America.' },
    { label: 'Letter', description: 'US and Canada.' },
    { label: 'Follow the browser locale', description: 'A4 or Letter, picked from where the person is.' },
  ],
}

export const QUESTIONS: Ask = {
  kind: 'question',
  id: 'q1',
  questions: [
    PAGE_SIZE,
    {
      header: 'Extras',
      question: 'What else goes on each page?',
      multiSelect: true,
      options: [
        { label: 'Page numbers' },
        { label: 'The note title as a running header' },
        { label: 'The export date in the footer' },
      ],
    },
    {
      header: 'File name',
      question: 'What should the downloaded file be called?',
      options: [
        { label: 'The note title', description: '“Quarterly plan.pdf”' },
        { label: 'Title and date', description: '“Quarterly plan — 2026-10-26.pdf”' },
      ],
    },
  ],
}

export const ONE_QUESTION: Ask = {
  kind: 'question',
  id: 'q2',
  questions: [PAGE_SIZE],
}

/** An MCP server's form: one of each field the dock draws. */
export const MCP_FORM: Ask = {
  kind: 'form',
  id: 'f1',
  server: 'linear',
  message: 'Where should the export bug be filed?',
  fields: [
    {
      key: 'team',
      type: 'enum',
      title: 'Team',
      required: true,
      options: [
        { value: 'web', label: 'Web' },
        { value: 'platform', label: 'Platform' },
      ],
    },
    { key: 'reporter', type: 'string', title: 'Reporter', format: 'email', description: 'Who hears back when it is fixed' },
    { key: 'estimate', type: 'number', title: 'Estimate (points)', integer: true, default: 2 },
    { key: 'urgent', type: 'boolean', title: 'Urgent' },
  ],
}

/** An MCP server's page to open: a sign-in. */
export const MCP_LINK: Ask = {
  kind: 'link',
  id: 'l1',
  server: 'linear',
  message: 'Sign in to Linear so the agent can file issues.',
  url: 'https://linear.app/oauth/authorize?client_id=runcastle&scope=issues:create',
}

const IDLE: ThreadItem[] = [
  ...HISTORY,
  {
    kind: 'work',
    id: 'w4',
    seconds: 223,
    steps: [
      { kind: 'thought', id: 'th4', seconds: 4, text: 'Parse with mdast, then map each block type to a PDF component.' },
      {
        kind: 'subagent',
        id: 's2',
        title: 'Find how the web app renders Markdown',
        status: 'completed',
        calls: [call({ id: 's2a', kind: 'search', title: 'react-markdown' }), call({ id: 's2b', kind: 'read', title: 'src/app/Markdown.tsx' })],
      },
      { kind: 'tools', id: 't4', calls: [call({ id: 'c10', kind: 'edit', title: 'src/server/note-document.tsx', diff: DOC_DIFF })] },
      { kind: 'narration', id: 'n2', text: 'One test fails: a long note now fits on 2 pages where the test expects 3. The test is out of date, not the export.' },
      {
        kind: 'tools',
        id: 't5',
        calls: [
          call({
            id: 'c11',
            kind: 'execute',
            title: 'bun test',
            status: 'failed',
            output: 'src/server/export.test.ts:\n✗ a long note breaks across pages [212ms]\n  Expected: 3\n  Received: 2\n\n 41 pass\n 1 fail',
          }),
          call({ id: 'c12', kind: 'edit', title: 'src/server/export.test.ts', diff: TEST_DIFF }),
          call({ id: 'c13', kind: 'execute', title: 'bun test', output: ' 42 pass\n 0 fail\nRan 42 tests across 9 files. [1.84s]' }),
        ],
      },
    ],
  },
  {
    kind: 'agent',
    id: 'a3',
    model: 'Opus 5.5',
    text:
      'Notes keep their structure in the PDF now, and all 42 tests pass.\n\n' +
      '1. Open any note with headings and a code block.\n' +
      '2. **Export as PDF** from the note menu.\n' +
      '3. Headings keep their sizes; code is mono and never splits across pages.\n\n' +
      'One test expected a fixed page count; it now counts pages from the rendered output instead.',
  },
  { kind: 'changes', id: 'ch1', files: CHANGES },
  { kind: 'user', id: 'r1', from: 'runcastle', text: 'Round 1 finished: 3 of 3 tickets landed, checks green.' },
  { kind: 'model', id: 'm1', model: 'Sonnet 5.5' },
  { kind: 'user', id: 'u3', text: 'Nice. Does the export still work for notes with no headings at all?' },
  {
    kind: 'work',
    id: 'w5',
    seconds: 12,
    steps: [{ kind: 'tools', id: 't6', calls: [call({ id: 'c14', kind: 'execute', title: 'bun test -t "plain note"', output: ' 1 pass' })] }],
  },
  { kind: 'agent', id: 'a4', model: 'Sonnet 5.5', text: 'Yes — a note with no Markdown at all renders as paragraphs, and there is a test for it (`plain note exports as paragraphs`).' },
]

const STARTING: ThreadItem[] = [
  ...IDLE,
  {
    kind: 'user',
    id: 'u9',
    text: 'The Export button sits lower than the others in the toolbar — line it up with them.',
    images: [CROP],
    starting: true,
  },
]

/** A conversation from the terminal era: no log, so plain turns read back from the transcript. */
const TERMINAL_ERA: ThreadItem[] = [
  { kind: 'user', id: 'o1', text: '/runcastle:feature' },
  {
    kind: 'agent',
    id: 'o2',
    text: 'I read the brief. One question before anything else: should the PDF include the note’s tags and dates, or just the title and body?',
  },
  { kind: 'user', id: 'o3', text: 'Just title and body.' },
  { kind: 'agent', id: 'o4', text: 'Recorded as decision 4. Next: should export work for several notes at once?' },
]

export type Moment =
  | 'working'
  | 'subagent'
  | 'approval'
  | 'edit-approval'
  | 'question'
  | 'one-question'
  | 'mcp-form'
  | 'mcp-link'
  | 'idle'
  | 'composing'
  | 'mention'
  | 'starting'
  | 'full'
  | 'new'
  | 'codex'
  | 'terminal-era'

export interface MomentSample {
  key: Moment
  label: string
  items: ThreadItem[]
  state: ThreadState
  ask?: Ask
  plan?: PlanEntry[]
  tasks?: BackgroundTask[]
  context: ContextUsage
  /** What the composer starts holding. */
  draft?: string
  attachments?: Attachment[]
  suggestion?: string
  /** The thread on show in the switcher. */
  thread: string
  /** The thread's runtime, whose models the composer offers. Claude Code when absent. */
  runtime?: 'codex'
}

const CTX: ContextUsage = { used: 61_400, size: 1_000_000, costUsd: 1.84 }

export const MOMENTS: MomentSample[] = [
  { key: 'working', label: 'Working', items: WORKING, state: 'working', plan: PLAN, tasks: TASKS, context: CTX, thread: 'main' },
  { key: 'subagent', label: 'Subagent running', items: SUBAGENT, state: 'working', context: CTX, thread: 'main' },
  { key: 'approval', label: 'Approval', items: ASKING, state: 'waiting', ask: APPROVAL, context: CTX, thread: 'main' },
  { key: 'edit-approval', label: 'Edit approval', items: ASKING, state: 'waiting', ask: EDIT_APPROVAL, context: CTX, thread: 'main' },
  { key: 'question', label: 'Questions', items: HISTORY.slice(0, 3), state: 'waiting', ask: QUESTIONS, context: CTX, thread: 'main' },
  { key: 'one-question', label: 'One question', items: HISTORY.slice(0, 3), state: 'waiting', ask: ONE_QUESTION, context: CTX, thread: 'main' },
  { key: 'mcp-form', label: 'MCP form', items: HISTORY.slice(0, 3), state: 'waiting', ask: MCP_FORM, context: CTX, thread: 'main' },
  { key: 'mcp-link', label: 'MCP link', items: HISTORY.slice(0, 3), state: 'waiting', ask: MCP_LINK, context: CTX, thread: 'main' },
  { key: 'idle', label: 'Idle', items: IDLE, state: 'idle', context: CTX, suggestion: 'Commit this and update the spec', thread: 'main' },
  { key: 'composing', label: 'Crop + /', items: IDLE, state: 'idle', draft: '/', attachments: [CROP], context: CTX, thread: 'main' },
  { key: 'mention', label: '@ file', items: IDLE, state: 'idle', draft: 'Look at @note', context: CTX, thread: 'main' },
  { key: 'starting', label: 'Starting', items: STARTING, state: 'idle', context: CTX, thread: 'main' },
  {
    key: 'full',
    label: 'Context filling',
    items: [{ kind: 'compacted', id: 'cp' }, ...IDLE.slice(4)],
    state: 'idle',
    context: { used: 171_000, size: 200_000, costUsd: 6.12 },
    thread: 'main',
  },
  { key: 'new', label: 'New thread', items: [], state: 'idle', context: { used: 0, size: 1_000_000 }, thread: 'new' },
  { key: 'codex', label: 'Codex thread', items: [], state: 'idle', context: { used: 0, size: 400_000 }, thread: 'new', runtime: 'codex' },
  { key: 'terminal-era', label: 'Terminal-era', items: TERMINAL_ERA, state: 'idle', context: CTX, thread: 'old' },
]

export function threads(current: Moment): ThreadEntry[] {
  const main = MOMENTS.find((m) => m.key === current)
  return [
    { id: 'main', title: 'Feature chat', role: 'main', state: main?.thread === 'main' ? main.state : 'idle', createdAt: NOW - 5 * 24 * 60 * MIN, updatedAt: NOW - 1 * MIN, runtime: 'claude-code' },
    { id: 'side1', title: 'Why is the PDF font blurry?', role: 'side', state: 'waiting', createdAt: NOW - 5 * 24 * 60 * MIN, updatedAt: NOW - 12 * MIN, runtime: 'claude-code' },
    { id: 'scen', title: 'Scenario: a note with 40 pages', role: 'scenario', state: 'idle', createdAt: NOW - 5 * 24 * 60 * MIN, updatedAt: NOW - 3 * 60 * MIN, runtime: 'claude-code' },
    { id: 'old', title: 'Planning (before web chat)', role: 'main', state: 'idle', createdAt: NOW - 5 * 24 * 60 * MIN, updatedAt: NOW - 4 * 24 * 60 * MIN, runtime: 'claude-code' },
    ...(current === 'new' ? [{ id: 'new', title: 'New thread', role: 'side' as const, state: 'idle' as const, createdAt: NOW - 5 * 24 * 60 * MIN, updatedAt: NOW, runtime: 'claude-code' as const }] : []),
  ]
}
