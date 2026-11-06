/**
 * The pictures on runcastle.dev/docs are the app's own components, rendered here
 * to static HTML with sample data and written into the docs pages between
 * `<!-- app:<name> -->` and `<!-- /app:<name> -->` markers. Each one sits in a
 * declarative shadow root with the app's compiled CSS, so the app's styles and
 * the site's never touch, and the pages stay free of JS.
 *
 * Rerun it whenever the app's look moves:
 *
 *   bun run --filter @runcastle/web build    # the app's CSS, into apps/web/dist
 *   bun apps/web/preview/docs-pages.tsx      # re-render every docs picture
 *
 * One running example throughout: tags on shiplog, the README's demo app.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesignEntry, ScenarioEntry, ThreadItem, Ticket } from '@runcastle/core'
import { TooltipProvider } from '../src/ui/tooltip'
import { Button } from '../src/ui'
import { ThreadItemView, opensTurn } from '../src/components/chat/thread/ChatThread'
import { cx } from '../src/ui'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { HeaderAction } from '../src/components/workspace/HeaderAction'
import { DesignBar } from '../src/components/design/DesignList'
import { TicketItem, type TicketControls } from '../src/components/bodies/tickets/TicketsView'
import { ReviewPackageCard } from '../src/components/review/ReviewPackageCard'
import { ScenarioControl } from '../src/components/review/ScenarioPicker'
import { DriveNotes } from '../src/components/review/DriveNotes'
import { Term } from '../src/components/Term'
import { Checklist, ChecklistRow } from '../src/components/EnableAfkCard'
import { StepActions, StepHeading } from '../src/components/first-run/StepLayout'
import { StepTable } from '../src/components/settings/StepTable'
import type { FilterState } from '../src/components/settings/types'
import type { SettingWrites } from '../src/components/settings/ModelsPage'
import type { ModelOptionGroup, StepRow } from '../src/lib/settings'
import { NoteDot, NoteRow } from '../src/components/project/NoteRow'
import { IconArrowRight, IconSparkle, IconTerminal } from '../src/icons'
import { TAGS_PACKAGE } from './readme-shots-data'

const root = resolve(import.meta.dirname, '../../..')
const site = join(root, 'site')
const noop = (): void => {}
const now = Date.now()

// ---------------------------------------------------------------- the frame

/** One app surface, as it sits in the app: a bordered panel on the canvas. */
function Panel({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-border bg-canvas">{children}</div>
}

/** The feature header row: title, status line, the one next step. */
function FeatureHeader({ title, status, action }: { title: string; status: Parameters<typeof FeatureStatusLine>[0]['status']; action?: Parameters<typeof HeaderAction>[0]['action'] }) {
  return (
    <div className="flex h-11 items-center gap-3 border-b border-border-subtle px-4">
      <span className="text-md font-medium text-text">{title}</span>
      <FeatureStatusLine status={status} />
      <span className="flex-1" />
      {action && <HeaderAction action={action} busy={false} onAction={noop} />}
    </div>
  )
}

/** A run of thread items, spaced as the chat thread spaces them. */
function Thread({ items }: { items: ThreadItem[] }) {
  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <div key={item.id} className={cx('flex min-w-0 flex-col', i > 0 && (opensTurn(item) ? 'mt-10' : 'mt-3'))}>
          <ThreadItemView item={item} locked={false} />
        </div>
      ))}
    </div>
  )
}

/** shiplog, the user's app, as their own dev server would draw it (not runcastle's UI). */
function Shiplog({ filter, entries }: { filter?: string; entries: { mood: 'win' | 'grind'; text: string; when: string; tags: string[] }[] }) {
  const mood = { win: { bg: '#173a26', fg: '#5fd08a' }, grind: { bg: '#3b3214', fg: '#e6c35c' } }
  const box = { border: '1px solid #2c3039', borderRadius: 10, background: '#1c1f26' }
  return (
    <div style={{ background: '#15171c', color: '#e8e9ec', font: '14px/1.5 system-ui, sans-serif', padding: '22px 24px' }}>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>shiplog</div>
      <div style={{ color: '#9aa0ab', margin: '2px 0 16px' }}>A tiny ship-journal.</div>
      {filter && (
        <div style={{ color: '#9aa0ab', fontSize: 13, margin: '0 0 10px' }}>
          Filter: <span style={{ color: '#7aaafa' }}>#{filter}</span>
        </div>
      )}
      {entries.map((e) => (
        <div key={e.text} style={{ ...box, padding: '12px 14px', marginBottom: 10 }}>
          <span style={{ background: mood[e.mood].bg, color: mood[e.mood].fg, borderRadius: 5, padding: '1px 7px', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em' }}>
            {e.mood.toUpperCase()}
          </span>
          {e.tags.map((t) => (
            <span key={t} style={{ marginLeft: 6, border: '1px solid #2f4a7a', color: '#9cc0ff', borderRadius: 999, padding: '0 8px', fontSize: 12 }}>
              #{t}
            </span>
          ))}
          <div style={{ margin: '6px 0 2px', fontSize: 15 }}>{e.text}</div>
          <div style={{ color: '#7c828e', fontSize: 12 }}>{e.when}</div>
        </div>
      ))}
    </div>
  )
}

const ENTRIES = [
  { mood: 'win' as const, text: 'Shipped the mood filter.', when: 'Today, 4:12 PM', tags: ['release'] },
  { mood: 'grind' as const, text: 'Chasing a flaky test in the entry store.', when: 'Yesterday, 6:30 PM', tags: ['bug', 'store'] },
]

// ---------------------------------------------------------------- the tickets

function ticket(seq: number, title: string, status: Ticket['status'], model: string, over: Partial<Ticket> = {}): Ticket {
  // A sample row: only the fields a closed ticket row reads are meaningful.
  return {
    id: `t${seq}`, featureId: 'feat_tags', seq, title, goal: '', context: '', acceptanceCriteria: [], seams: [],
    blockedBy: [], kind: 'implementation', status, model, commits: status === 'done' ? [`${seq}e4f1a9c0b2d7`] : [],
    reviewedCommit: null, completedAt: null, ...over,
  } as unknown as Ticket
}

const TICKETS: Ticket[] = [
  ticket(1, 'A tags table and the entry-to-tag link', 'done', 'claude-sonnet-5-5'),
  ticket(2, 'Tag chips on an entry: add, suggest, remove', 'burning', 'gpt-6-sol', { blockedBy: [1] }),
  ticket(3, 'Filter the feed by one or more tags', 'burning', 'claude-sonnet-5-5', { blockedBy: [1] }),
  ticket(4, 'Review: test drive tagging and filtering', 'pending', 'claude-opus-5-5', { kind: 'review', blockedBy: [1, 2, 3] }),
]

// The row is only ever drawn closed here, so none of its actions run.
const CONTROLS = {
  roster: [
    { id: 'claude-sonnet-5-5', runtime: 'claude-code' },
    { id: 'claude-opus-5-5', runtime: 'claude-code' },
    { id: 'gpt-6-sol', runtime: 'codex' },
  ],
  busy: false, terminalBlocked: false, featureBranch: 'feature/entry-tags', stopping: undefined, cancelling: undefined,
  stop: noop, setModel: noop, save: async () => {}, cancel: noop, resolveInTerminal: noop, copySha: noop,
  facts: new Map(), durations: new Map(), bootEvents: () => [], runtime: () => undefined,
} as unknown as TicketControls

// ---------------------------------------------------------------- the models table

const OPUS = 'claude-opus-5-5'
const STEPS: StepRow[] = [
  { step: 'chat', label: 'Chat', description: 'The feature chat', group: 'sessions', value: null, effectiveModel: OPUS, effectiveRuntime: 'claude-code' },
  { step: 'project', label: 'Orchestrator chat', description: 'The project-level chat', group: 'sessions', value: null, effectiveModel: OPUS, effectiveRuntime: 'claude-code' },
  { step: 'implement', label: 'Implement', description: 'Works a ticket in the sandbox', group: 'unattended', value: 'gpt-6-sol', effectiveModel: 'gpt-6-sol', effectiveRuntime: 'codex' },
  { step: 'review', label: 'Review', description: 'Reads the finished branch', group: 'unattended', value: 'claude-sonnet-5-5', effectiveModel: 'claude-sonnet-5-5', effectiveRuntime: 'claude-code' },
] as StepRow[]
const GROUPS: ModelOptionGroup[] = [
  { runtime: 'claude-code', label: 'Claude Code', entries: [{ id: OPUS, runtime: 'claude-code' }, { id: 'claude-sonnet-5-5', runtime: 'claude-code' }] },
  { runtime: 'codex', label: 'Codex', entries: [{ id: 'gpt-6-sol', runtime: 'codex' }] },
] as ModelOptionGroup[]
// Nothing is filtered and nothing writes: the table is only drawn.
const FILTER = { query: '', counts: {}, matches: new Set<string>() } as unknown as FilterState
const WRITES: SettingWrites = { save: noop, refuse: noop, saved: null, error: null }

// ---------------------------------------------------------------- the pictures

const SCENARIO: ScenarioEntry = { file: '.runcastle/scenarios/tags/entries-with-tags.ts', group: 'Tags', name: 'Entries with tags', own: true, hasCall: false }

const DESIGN: DesignEntry = { id: 'dsn_1', title: 'Tag chips on an entry', path: '/preview/tag-chips.html', width: 1440, state: 'waiting', isNew: true, shownAt: now - 60_000 }

/** Each picture: the element, and the width it is laid out at. */
const PICTURES: Record<string, { width: number; el: ReactElement }> = {
  wizard: {
    width: 600,
    el: (
      <Panel>
        <div className="px-6 py-6">
          <StepHeading title="Connect a coding agent">
            runcastle drives whichever agent you have — sign in to one or both. The ones you connect here are the ones whose models you can pick later.
          </StepHeading>
          <div className="mt-6">
            <Checklist>
              <ChecklistRow label="Claude Code" status="Ready" detail="Signed in" ok />
              <ChecklistRow label="Codex" status="Not signed in" detail="Installed" ok={false}>
                <Button size="sm" icon={<IconTerminal />} onClick={noop}>
                  Run codex login
                </Button>
              </ChecklistRow>
            </Checklist>
          </div>
          <StepActions>
            <Button variant="primary" icon={<IconArrowRight />} onClick={noop}>
              Continue
            </Button>
          </StepActions>
        </div>
      </Panel>
    ),
  },
  models: {
    width: 640,
    el: (
      <Panel>
        <div className="px-5 pt-4 pb-5">
          <h2 className="m-0 text-md font-medium text-text">Per step</h2>
          <p className="mt-1 mb-0 text-sm text-text-tertiary">Every step runs the default unless it names a model of its own.</p>
          <StepTable rows={STEPS} groups={GROUPS} defaultModel={OPUS} projectModel={null} filter={FILTER} writes={WRITES} />
        </div>
      </Panel>
    ),
  },
  orchestrator: {
    width: 660,
    el: (
      <Panel>
        <div className="flex h-11 items-center gap-2 border-b border-border-subtle px-4">
          <span className="text-md font-medium text-text">Orchestrator</span>
          <span className="text-sm text-text-tertiary">Shared team feed</span>
        </div>
        <div className="px-5 py-4">
          <Thread
            items={[
              { kind: 'user', id: 'u3', text: 'Everyone on the team posts to one feed, and on Friday we all get a recap email of what shipped.' },
              { kind: 'work', id: 'w3', steps: [], seconds: 120 },
              {
                kind: 'agent',
                id: 'a3',
                text:
                  'About two thirds of this is already in flight:\n\n- **The shared feed** is mostly *Realtime team collaboration*, building now.\n- **The Friday email** can share *Weekly digest email*\'s sending code.\n\nWhat neither covers: entries have no author, and nobody has an email address.\n\nFirst question, since it decides the size of this: **is one install one team**, or do you want real accounts?',
              },
            ]}
          />
        </div>
      </Panel>
    ),
  },
  notes: {
    width: 520,
    el: (
      <Panel>
        <div className="flex h-10 items-center border-b border-border-subtle px-4 text-sm font-medium text-text">Notes</div>
        <section aria-label="Notes" className="flex flex-col">
          <div className="flex items-center gap-3 px-4 pt-3 pb-2">
            <span className="min-w-0 flex-1 text-xs text-pretty text-text-tertiary">Grouped, questioned and routed in a triage chat.</span>
            <Button size="sm" icon={<IconSparkle />} className="shrink-0" onClick={noop}>
              Triage 3
            </Button>
          </div>
          <ul className="m-0 flex list-none flex-col px-1 py-1">
            <NoteRow lead={<NoteDot />} when="33m">The empty feed says "No entries" while it is still loading.</NoteRow>
            <NoteRow lead={<NoteDot />} when="56m">Mood chips wrap onto a second line at phone width.</NoteRow>
            <NoteRow lead={<NoteDot />} when="3h">Let me press N anywhere to start a new entry.</NoteRow>
          </ul>
        </section>
      </Panel>
    ),
  },
  plan: {
    width: 640,
    el: (
      <Panel>
        <FeatureHeader title="Entry tags" status={{ kind: 'waiting', label: 'Plan to approve' }} action={{ label: 'Open plan', kind: 'openPlan' }} />
        <div className="px-5 py-4">
          <Thread
            items={[
              { kind: 'user', id: 'u1', text: 'Let me tag entries and filter the feed by one or more tags.' },
              { kind: 'work', id: 'w1', steps: [], seconds: 252 },
              {
                kind: 'agent',
                id: 'a1',
                text:
                  'Three tickets, in the order they can land:\n\n1. **A tags table** and the entry-to-tag link\n2. **Tag chips** on an entry: add, suggest, remove\n3. **Filter the feed** by one or more tags\n\n#2 and #3 build side by side once #1 lands, and a review round test drives the result. Say yes and I start round 1.',
              },
            ]}
          />
        </div>
      </Panel>
    ),
  },
  design: {
    width: 800,
    el: (
      <Panel>
        <div className="grid grid-cols-1 sm:grid-cols-[5fr_7fr]">
          <div className="px-5 py-4">
            <Thread
              items={[
                {
                  kind: 'agent',
                  id: 'a2',
                  text: 'I built the tag chips with your own `EntryCard`, on sample entries. It is your app, running.\n\nApprove it, or tell me what to change.',
                },
              ]}
            />
          </div>
          <div className="border-t border-border-subtle sm:border-t-0 sm:border-l">
            <DesignBar design={DESIGN} index={0} count={1} othersWaiting={0} onBack={noop} onStep={noop} onApprove={noop} />
            <Shiplog entries={ENTRIES} />
          </div>
        </div>
      </Panel>
    ),
  },
  round: {
    width: 620,
    el: (
      <Panel>
        <div className="px-4 py-3">
          <div className="mb-2 flex min-h-7 items-center gap-2">
            <h2 className="m-0 text-sm font-medium text-text">
              <Term id="round">Round</Term> 1
            </h2>
            <span className="text-shimmer min-w-0 truncate text-xs text-text-secondary">Running · 1 of 4 landed</span>
            <span className="ml-auto text-xs text-text-tertiary tabular-nums">6m 12s</span>
          </div>
          <div className="-mx-2.5 flex flex-col gap-0.5">
            {TICKETS.map((t) => (
              <TicketItem key={t.id} ticket={t} tickets={TICKETS} controls={CONTROLS} />
            ))}
          </div>
        </div>
      </Panel>
    ),
  },
  review: {
    width: 600,
    el: (
      <Panel>
        <div className="flex flex-col gap-3 px-5 py-4">
          <ReviewPackageCard pack={TAGS_PACKAGE} onOpen={noop} />
          <div className="flex items-center gap-3">
            <FeatureStatusLine status={{ kind: 'ready', label: 'Ready to merge' }} />
            <HeaderAction action={{ label: 'Merge & ship', kind: 'merge' }} busy={false} onAction={noop} />
          </div>
        </div>
      </Panel>
    ),
  },
  drive: {
    width: 820,
    el: (
      <Panel>
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-1.5">
          <span className="text-sm text-text-secondary">
            Driving <span className="font-mono text-text">feature/entry-tags</span>
          </span>
          <ScenarioControl
            menu={{ own: [SCENARIO], others: [], othersLabel: 'Scenarios', defaultScenario: SCENARIO }}
            scenario={{ file: SCENARIO.file, name: SCENARIO.name, status: 'landed' }}
            blank={false}
            onPick={noop}
            onNew={noop}
          />
          <span className="flex-1" />
          <Button size="sm" variant="secondary" onClick={noop}>
            Stop drive
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[7fr_5fr]">
          <Shiplog filter="release" entries={[ENTRIES[0]!, { mood: 'win', text: 'Markdown export works, tables included.', when: 'Mon, 11:05 AM', tags: ['release', 'export'] }]} />
          <div className="flex flex-col border-t border-border-subtle sm:border-t-0 sm:border-l">
            <div className="flex h-10 items-center px-4 text-sm font-medium text-text">Notes</div>
            <DriveNotes
              notes={[{ id: 'n1', text: 'Removing the last tag leaves an empty chip behind.', when: '1m' }]}
              foot={null}
              onOpenPicture={noop}
              onEdit={noop}
              onDelete={noop}
              onPicture={noop}
            />
          </div>
        </div>
      </Panel>
    ),
  },
}

// ---------------------------------------------------------------- writing

const BASE =
  'font-family:var(--font-sans);color:var(--color-text);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;text-align:left'

function shadowed(name: string): string {
  const pic = PICTURES[name]
  if (!pic) throw new Error(`no picture "${name}"`)
  let html = renderToStaticMarkup(<TooltipProvider>{pic.el}</TooltipProvider>)
  if (name === 'models') {
    // Radix's SelectValue writes the chosen item's text only once mounted in a
    // browser; a static render leaves it empty. Fill each row's in order, with
    // the words the app shows there.
    const shown = STEPS.map((r) => r.value ?? `Default (${OPUS})`)
    let i = 0
    html = html.replace(/<span style="pointer-events:none"><\/span>/g, () => `<span style="pointer-events:none">${shown[i++] ?? ''}</span>`)
    if (i !== shown.length) throw new Error(`models: filled ${i} selects for ${shown.length} rows`)
  }
  return (
    `<div class="doc-app" style="--w: ${pic.width}px"><template shadowrootmode="open">` +
    `<link rel="stylesheet" href="/assets/docs/app.css" /><div style="${BASE}">${html}</div>` +
    `</template></div>`
  )
}

// The app's CSS, without its @font-face rules: the site loads Geist itself, and
// a shadow root ignores @font-face anyway.
const dist = join(root, 'apps/web/dist/assets')
const cssFile = readdirSync(dist).find((f) => f.startsWith('index-') && f.endsWith('.css'))
if (!cssFile) throw new Error('no built CSS in apps/web/dist/assets: run `bun run --filter @runcastle/web build` first')
const built = readFileSync(join(dist, cssFile), 'utf8').replace(/@font-face\{[^}]*\}/g, '')
// Tailwind declares its defaults (a solid border style among them) with
// @property, which a shadow root ignores; its own fallback block for browsers
// without @property says the same, so it applies here unconditionally.
const fallback = built.match(/\*,:before,:after,::backdrop\{[^}]*\}/)?.[0]
if (!fallback) throw new Error('the built CSS has no Tailwind property fallback block')
const css = `${built}\n${fallback}`
writeFileSync(join(site, 'assets/docs/app.css'), css)

const MARK = /<!-- app:([a-z-]+) -->[\s\S]*?<!-- \/app:\1 -->/g
let count = 0
for (const page of ['docs/index.html', 'docs/features/index.html', 'docs/orchestrator/index.html', 'docs/vps/index.html']) {
  const path = join(site, page)
  const before = readFileSync(path, 'utf8')
  const after = before.replace(MARK, (_, name: string) => {
    count++
    return `<!-- app:${name} -->${shadowed(name)}<!-- /app:${name} -->`
  })
  if (after !== before) writeFileSync(path, after)
}
console.log(`docs-pages: ${count} pictures rendered, app.css ${(css.length / 1024).toFixed(0)} KB`)
// Some app modules start timers on import (live clocks, polling helpers); the
// render is done, so leave rather than wait on them.
process.exit(0)
