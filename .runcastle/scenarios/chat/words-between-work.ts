/**
 * Scenario: a project chat whose turns have words between their work
 * (every-word-the-agent-writes-stays-in-view). One chat, three turns:
 *
 * - a long multi-step turn: words, folded runs of reads, edits and test runs
 *   between them, a thinking-only gap, a picture shown mid-turn, a question at
 *   the end, and the turn's changed files;
 * - a short reply: words only;
 * - a chatty turn: a one-line message before every tool call.
 *
 * A real agent's turn is not reproducible, so the review and the test drive
 * start here. Nothing runs: the chat is a log, with times spread out so each
 * fold says a real duration.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR` — and prints the chat's page as `ENTRY_URL=…`.
 *
 * `SCENARIO_PROJECT` names a different project to seed.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { DiffLine, FileChange, ShownFile, ThreadEvent, ThreadEventBody, ToolCall } from '../../../packages/core/src/thread.ts'
import { dbPath, sessionDir } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { createSessionRow, markSessionEnded, setSessionTitle } from '../../../packages/server/src/launcher/sessions.ts'
import { listProjects } from '../../../packages/server/src/services/projects.ts'
import { seedThreadLog } from '../../../packages/server/src/threads/log.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const PROJECT = process.env.SCENARIO_PROJECT || 'runcastle-demo'
const MODEL = { id: 'claude-opus-5-5', label: 'Opus 5.5' }

/** A PDF page, drawn: the picture the long turn shows mid-turn. */
const PAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300"><rect width="640" height="300" fill="#f4f4f2"/><rect x="40" y="24" width="560" height="276" fill="#fff" stroke="#ddd"/><rect x="72" y="52" width="220" height="16" rx="2" fill="#222"/><rect x="72" y="84" width="460" height="8" rx="2" fill="#999"/><rect x="72" y="100" width="420" height="8" rx="2" fill="#999"/><rect x="72" y="126" width="160" height="12" rx="2" fill="#444"/><rect x="72" y="150" width="496" height="74" rx="4" fill="#eef0f3"/><rect x="88" y="166" width="260" height="7" rx="2" fill="#6b7280"/><rect x="88" y="182" width="320" height="7" rx="2" fill="#6b7280"/><rect x="88" y="198" width="200" height="7" rx="2" fill="#6b7280"/><rect x="72" y="244" width="440" height="8" rx="2" fill="#999"/></svg>`

function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) throw new Error(`refusing to seed ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  return resolve(dir)
}

const done = (id: string, kind: ToolCall['kind'], title: string, extra: Partial<ToolCall> = {}): ThreadEventBody => ({
  type: 'tool',
  call: { id, kind, title, status: 'completed', ...extra },
})
const say = (messageId: string, text: string): ThreadEventBody => ({ type: 'agent_text', messageId, text })
const think = (thoughtId: string, text: string): ThreadEventBody => ({ type: 'thought', thoughtId, text })
const swap = (from: string, to: string): DiffLine[] => [
  { op: '-', text: from },
  { op: '+', text: to },
]

/** The chat's log: each body with how many seconds into the chat it happened. */
function conversation(picture: ShownFile): Array<[number, ThreadEventBody]> {
  const docDiff = swap('  return <Page><Text>{note.body}</Text></Page>', '  return <Page size="A4">{toBlocks(note.body).map(renderBlock)}</Page>')
  const testDiff = swap('  expect(pageCount(pdf)).toBe(3)', '  expect(pageCount(pdf)).toBe(expectedPages(longNote))')
  const changed: FileChange[] = [
    { path: 'src/server/note-document.tsx', added: 27, removed: 4, lines: docDiff },
    { path: 'src/server/markdown-blocks.ts', added: 41, removed: 0, lines: [{ op: '+', text: 'export function toBlocks(md: string) {' }] },
    { path: 'src/server/export.test.ts', added: 1, removed: 1, lines: testDiff },
  ]
  const renamed = ['src/server/export.ts', 'src/server/routes.ts', 'src/server/export.test.ts', 'src/app/NoteMenu.tsx', 'src/app/api.ts', 'src/app/NoteView.tsx']
  return [
    [0, { type: 'model', model: MODEL.id, label: MODEL.label }],
    // The long multi-step turn.
    [1, { type: 'prompt', id: 'p_1', text: 'Can notes keep their headings and code blocks in the PDF? Right now everything comes out as one paragraph.', source: 'human' }],
    [2, { type: 'turn_started' }],
    [3, think('th_1', 'The body probably goes straight into one Text node. Check NoteDocument and how the web app renders Markdown.')],
    [9, done('c_1', 'read', 'Read src/server/export.ts')],
    [12, done('c_2', 'read', 'Read src/server/note-document.tsx')],
    [20, done('c_3', 'search', 'react-markdown')],
    [41, say('m_1', 'The PDF flattens the note because `NoteDocument` renders the whole body as one `<Text>`: the Markdown is never parsed.\n\nThe web app renders Markdown with `react-markdown`, which only targets HTML, so I will parse with `mdast` on the server and map each block to a PDF component myself.')],
    [44, done('c_4', 'edit', 'Edit src/server/markdown-blocks.ts', { diff: { path: 'src/server/markdown-blocks.ts', lines: changed[1].lines } })],
    [80, done('c_5', 'edit', 'Edit src/server/note-document.tsx', { diff: { path: 'src/server/note-document.tsx', lines: docDiff } })],
    [116, say('m_2', 'Fixes in; running the full test suite.')],
    [118, done('c_6', 'execute', 'bun run typecheck')],
    [131, done('c_7', 'execute', 'bun test', { status: 'failed', output: '1 failed: export > a long note breaks across pages\n  expected 3, received 4' })],
    [140, done('c_8', 'edit', 'Edit src/server/export.test.ts', { diff: { path: 'src/server/export.test.ts', lines: testDiff } })],
    [158, done('c_9', 'execute', 'bun test')],
    [164, say('m_3', 'One test failed, and the test was wrong rather than the code: it expected a long note to take exactly 3 pages, but code blocks no longer break across a page, so it now takes 4. I changed it to count the pages from the note itself. The whole suite passes now.')],
    [166, think('th_2', 'Render the sample note so the human can see a heading and a code block on a real page.')],
    [171, say('m_4', 'Here is the sample note exported, with its heading and a code block:')],
    [172, done('c_10', 'other', 'mcp__runcastle__show_file')],
    [172, { type: 'file_shown', file: picture }],
    [173, say('m_5', 'Headings, code blocks and lists now come through.\n\nOne thing I did not decide for you: should a long line in a code block wrap, or should the block shrink to fit the page? I would wrap it, because shrinking makes long lines too small to read.')],
    [174, { type: 'turn_ended', reason: 'end_turn', files: changed }],
    // A short reply: words only.
    [240, { type: 'prompt', id: 'p_2', text: 'Wrap them. Does the export still work for notes with no headings at all?', source: 'human' }],
    [241, { type: 'turn_started' }],
    [246, say('m_6', 'Yes: a note with no headings is a run of paragraphs, which is what the export already handled. I will wrap long code lines in the next change.')],
    [247, { type: 'turn_ended', reason: 'end_turn' }],
    // A chatty turn: a line before every tool call.
    [300, { type: 'prompt', id: 'p_3', text: 'Rename `exportNote` to `exportNoteAsPdf` everywhere.', source: 'human' }],
    [301, { type: 'turn_started' }],
    [302, say('m_7', 'Searching for every use.')],
    [303, done('c_11', 'search', 'exportNote')],
    [305, say('m_8', 'Six files use it: three in the server, three in the web app. Renaming the server first.')],
    [306, done('c_12', 'edit', 'Edit src/server/export.ts', { diff: { path: renamed[0], lines: swap('exportNote', 'exportNoteAsPdf') } })],
    [310, done('c_13', 'edit', 'Edit src/server/routes.ts', { diff: { path: renamed[1], lines: swap('exportNote', 'exportNoteAsPdf') } })],
    [315, done('c_14', 'edit', 'Edit src/server/export.test.ts', { diff: { path: renamed[2], lines: swap('exportNote', 'exportNoteAsPdf') } })],
    [316, say('m_9', 'Now the web app.')],
    [317, done('c_15', 'edit', 'Edit src/app/NoteMenu.tsx', { diff: { path: renamed[3], lines: swap('exportNote', 'exportNoteAsPdf') } })],
    [320, done('c_16', 'edit', 'Edit src/app/api.ts', { diff: { path: renamed[4], lines: swap('exportNote', 'exportNoteAsPdf') } })],
    [323, done('c_17', 'edit', 'Edit src/app/NoteView.tsx', { diff: { path: renamed[5], lines: swap('exportNote', 'exportNoteAsPdf') } })],
    [324, say('m_10', 'Running the typecheck.')],
    [325, done('c_18', 'execute', 'bun run typecheck')],
    [338, say('m_11', 'Typecheck passes. Running the export tests.')],
    [339, done('c_19', 'execute', 'bun test src/server/export.test.ts')],
    [360, say('m_12', 'Renamed in all six files; the typecheck and the export tests pass.')],
    [361, { type: 'turn_ended', reason: 'end_turn', files: renamed.map((path) => ({ path, added: 1, removed: 1, lines: swap('exportNote', 'exportNoteAsPdf') })) }],
  ]
}

async function main(): Promise<void> {
  process.env.RUNCASTLE_DATA_DIR = driveDataDir()
  const db = createDb(dbPath())
  try {
    runMigrations(db)
    const ctx: AppCtx = { db, config: loadConfig() }
    const project = listProjects(ctx).find((p) => p.name === PROJECT || basename(p.repoPath) === PROJECT)
    if (!project) throw new Error(`${PROJECT} is not registered in this drive's data dir`)

    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')
    const chat = createSessionRow(ctx, {
      projectId: project.id,
      kind: 'project',
      worktreePath: project.repoPath,
      model: { id: MODEL.id, runtime: 'claude-code' },
    })
    setSessionTitle(ctx, chat.id, `Words between work ${run}`)
    markSessionEnded(ctx, chat.id)

    // The picture, kept with the thread as a shown file's copy is.
    const file = `file_${randomBytes(6).toString('hex')}.svg`
    const shownDir = join(sessionDir(chat.id), 'shown')
    mkdirSync(shownDir, { recursive: true })
    writeFileSync(join(shownDir, file), PAGE_SVG)
    const picture: ShownFile = {
      id: file.slice(0, -'.svg'.length),
      src: `/api/threads/${chat.id}/files/${file}`,
      name: 'sample-note.svg',
      path: 'tmp/sample-note.svg',
      size: PAGE_SVG.length,
      as: 'image',
      caption: 'Page 1 of the sample note: a heading, a paragraph and a code block',
    }

    const start = Date.now() - 2 * 60 * 60_000
    const events = conversation(picture).map(([seconds, body], i) => ({ ...body, i, at: start + seconds * 1000 }) as ThreadEvent)
    seedThreadLog(chat.id, events)

    console.log(`ENTRY_URL=/p/${encodeURIComponent(project.id)}/chat?thread=${encodeURIComponent(chat.id)}`)
  } finally {
    // Checkpoint the WAL into the db file for any reader after us (see feature-at-review.ts).
    const client = (db as unknown as { $client: { exec(sql: string): void; close(): void } }).$client
    client.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    client.close()
  }
}

try {
  await main()
} catch (e) {
  console.error(`[words-between-work] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
