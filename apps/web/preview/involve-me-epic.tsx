import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { INVOLVEMENT_LABEL, type Involvement } from '@runcastle/core'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider, useToast } from '../src/lib/toast'
import { cx } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { Markdown } from '../src/components/Markdown'
import { WELL } from '../src/components/chat/thread/surfaces'
import { WorkBlock } from '../src/components/chat/thread/Work'
import { FeaturesCard, type FeatureActionRow } from '../src/components/chat/thread/FeatureCards'
import { PanelToggle } from '../src/components/workspace/FeaturePanel'
import { EpicGlyph } from '../src/components/SidebarEpics'
import { SetAllInvolvement } from '../src/components/involvement/Involvement'
import { applyStoredTheme } from '../src/lib/theme'
import type { FeatureListItem } from '../src/lib/api'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { useDesignReport } from '../../../.runcastle/preview/design-report'
import { listItem } from '../test/fixtures'
import { DESIGN_PANEL_CLEARANCE, DesignPanel, makeDeadEnd } from './design-panel-kit'

/**
 * "Involve me in" on an epic (docs/features/how-involved-am-i decisions 3, 4,
 * 5, 7): the epic's chat right after the orchestrator cut four features. Each
 * created row carries its own "Involve me in" picker, the epic's
 * recommendation preselected; the header carries "Set all to…" for every
 * feature of the epic. The real features card, header and pickers over sample
 * data; picks change the page and say what they did.
 *
 * States: ?state=just-cut | mixed | bedtime.
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

type StateKey = 'just-cut' | 'mixed' | 'bedtime'

const STATES: { key: StateKey; label: string; hint: string }[] = [
  {
    key: 'just-cut',
    label: 'Just cut',
    hint: 'The orchestrator created four features, each at the level it recommends. Change one on its row, or all of them from the header.',
  },
  { key: 'mixed', label: 'Mixed', hint: 'The features differ: the header says “Mixed”. Its menu sets all four at once.' },
  { key: 'bedtime', label: 'Bedtime', hint: 'After “Set all to… Result only”: they build overnight, and you try each one and merge it in the morning.' },
]

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((s) => s.key === params.get('state'))?.key ?? 'just-cut'

const EPIC = { title: 'Checkout flow', color: 'violet', icon: 'credit-card' } as const

let n = 0
function feature(title: string, over: Partial<FeatureListItem> = {}): FeatureListItem {
  n += 1
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  return { ...listItem({ id: `feat_${n}`, slug, ...over }), branch: `feature/${slug}`, title, ...over } as FeatureListItem
}

const PAGE = feature('Checkout page', { liveSession: { status: 'live', awaitingInput: false } } as Partial<FeatureListItem>)
const CARDS = feature('Saved cards', { liveSession: { status: 'live', awaitingInput: false } } as Partial<FeatureListItem>)
const RECEIPTS = feature('Receipt emails', { liveSession: { status: 'live', awaitingInput: false } } as Partial<FeatureListItem>)
const COUPONS = feature('Coupon codes', { status: 'draft' })

const ROWS: FeatureActionRow[] = [
  { featureId: PAGE.id, feature: PAGE, title: PAGE.title, actions: ['created', 'started'] },
  { featureId: CARDS.id, feature: CARDS, title: CARDS.title, actions: ['created', 'started'] },
  { featureId: RECEIPTS.id, feature: RECEIPTS, title: RECEIPTS.title, actions: ['created', 'started'] },
  { featureId: COUPONS.id, feature: COUPONS, title: COUPONS.title, actions: ['parked'] },
]

/** The orchestrator's recommendation per feature: screens get the human's eye, plumbing does not. */
const RECOMMENDED: Record<string, Involvement> = {
  [PAGE.id]: 'everything',
  [CARDS.id]: 'designsAndResult',
  [RECEIPTS.id]: 'resultOnly',
  [COUPONS.id]: 'everything',
}

function levelsFor(state: StateKey): Record<string, Involvement> {
  if (state === 'bedtime') return Object.fromEntries(ROWS.map((r) => [r.featureId, 'resultOnly' as const]))
  if (state === 'mixed') return { ...RECOMMENDED, [PAGE.id]: 'designsAndResult', [COUPONS.id]: 'nothing' }
  return RECOMMENDED
}

const ASK = 'Cut checkout into features. Start the first three; park coupons.'
const ANSWER =
  'Three are working now and coupons waits in the backlog. Each starts at the level I recommend: the checkout page asks you everything, saved cards shows you its screens, receipt emails only needs you to try it. Change any of them below.'

const call = (id: string, title: string) => ({ id, kind: 'other' as const, title, status: 'completed' as const })

function You({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className={cx(WELL, 'max-w-[85%] px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-text')}>{text}</div>
    </div>
  )
}

function Column({ pieces }: { pieces: { turn?: boolean; node: ReactNode }[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable]">
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col pt-8 pb-24">
        {pieces.map((p, i) => (
          <div key={i} className={cx('flex min-w-0 flex-col', i > 0 && (p.turn ? 'mt-10' : 'mt-3'))}>
            {p.node}
          </div>
        ))}
      </div>
    </div>
  )
}

function EpicChat({ state }: { state: StateKey }) {
  const [levels, setLevels] = useState<Record<string, Involvement>>(() => levelsFor(state))
  const toast = useToast()
  const title = (id: string) => ROWS.find((r) => r.featureId === id)?.title ?? id
  const setOne = (id: string, level: Involvement) => {
    setLevels((l) => ({ ...l, [id]: level }))
    toast.push(`${title(id)}: Involve me in ${INVOLVEMENT_LABEL[level]}`, 'success')
  }
  const setAll = (level: Involvement) => {
    setLevels(Object.fromEntries(ROWS.map((r) => [r.featureId, level])))
    toast.push(`All ${ROWS.length} features: Involve me in ${INVOLVEMENT_LABEL[level]}`, 'success')
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={EPIC.title}>
      <PageTopbar
        crumbs={[{ label: EPIC.title, icon: <EpicGlyph small color={EPIC.color} icon={EPIC.icon} /> }]}
        trail
        actions={
          <>
            <SetAllInvolvement levels={ROWS.map((r) => levels[r.featureId]!)} onSetAll={setAll} />
            <PanelToggle open={false} views={['details']} onToggle={() => {}} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 bg-surface">
        <Column
          pieces={[
            { turn: true, node: <You text={ASK} /> },
            {
              node: (
                <WorkBlock
                  steps={[
                    {
                      kind: 'tools',
                      id: 't',
                      calls: [
                        call('c1', 'mcp__runcastle__create_feature'),
                        call('c2', 'mcp__runcastle__create_feature'),
                        call('c3', 'mcp__runcastle__create_feature'),
                        call('c4', 'mcp__runcastle__create_feature'),
                      ],
                    },
                  ]}
                  seconds={41}
                />
              ),
            },
            {
              node: (
                <FeaturesCard
                  rows={ROWS}
                  onOpen={() => {}}
                  involvement={{ levelOf: (r) => levels[r.featureId] ?? null, onChange: setOne }}
                />
              ),
            },
            { node: <Markdown source={ANSWER} size="base" tone="primary" breaks /> },
          ]}
        />
      </div>
    </section>
  )
}

function Page() {
  const [state, setState] = useState<StateKey>(pickState)
  useDesignReport(state)
  const go = (k: StateKey) => {
    setState(k)
    history.replaceState(null, '', `?state=${k}`)
  }
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <div className={cx('flex min-h-0 flex-1 p-3', DESIGN_PANEL_CLEARANCE)}>
        <EpicChat key={state} state={state} />
      </div>
      <DesignPanel states={STATES} state={state} onPick={go} />
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')
createRoot(rootEl).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
