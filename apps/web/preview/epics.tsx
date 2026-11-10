import { StrictMode, useMemo, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx, IconButton, Kbd, SectionLabel } from '../src/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../src/ui/dropdown-menu'
import { PageTopbar, type Crumb } from '../src/ui/page'
import { OwnerControl, type FeatureOwner } from '../src/components/workspace/OwnerControl'
import { ProjectSwitcher } from '../src/components/ProjectSwitcher'
import { CollapseSidebarButton } from '../src/components/Frame'
import {
  FeatureProgressIcon,
  featureStateWords,
  OrchestratorCard,
  Shelf,
  SidebarBackdrop,
  SidebarFeatureRow,
  SidebarStatusLine,
  SidebarThreadList,
  WorkingShelf,
} from '../src/components/SidebarParts'
import { EpicGlyph, SidebarEpicRow, SidebarEpics } from '../src/components/SidebarEpics'
import {
  IconArchive,
  IconClock,
  IconDoc,
  IconGitMerge,
  IconList,
  IconMessage,
  IconMore,
  IconPanelRight,
  IconPencil,
  IconSearch,
} from '../src/icons'
import { sidebarLanes } from '../src/lib/feature-ui'
import { featureIsYellow, nestedFeatureWords, shelfFeatureWords, type Epic, type EpicHolder } from '../src/lib/feature-ui/epics'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { shortcut } from '../src/lib/platform'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { useIsPhone } from '../src/lib/use-phone'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, project } from '../../../.runcastle/preview/shell-fakes'
import { EVERY_CHAT_NAMED, STATES, type Open, type Sample, type Shelved, type StateKey } from './epics-data'

/**
 * Orchestrator chats become epics (docs/features/orchestrator-chats-become-epics):
 * the sidebar is one list of epics, each an orchestrator chat with the features
 * it cut nested under it, then "Other features", then the shelves. Composed
 * from the real pieces (SidebarEpics, SidebarParts) over sample data.
 *
 * States: ?state=busy | asking | taken-over | new-chat | many | quiet.
 * Tweaks: ?shape=A|B|C (A epics, the component; B today's lanes with epic tags;
 * C a Needs-you strip over the epics) and ?naming=every|first-cut|chats.
 * B and C live only in this file. Click rows to move around; links do nothing.
 */

applyStoredTheme()
installSilentEventSource()
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
  },
  true,
)

const nav = {
  projects: [project],
  loading: false,
  doctorError: null,
  recheckDoctor: () => {},
  view: 'project',
  currentProjectId: PROJECT_ID,
  currentProject: project,
  goHome: () => {},
  enterProject: () => {},
  showOpen: () => {},
  cancelOpen: () => {},
} as unknown as ProjectNavApi

const noop = () => {}

// ---------------------------------------------------------------------------
// The Tweaks
// ---------------------------------------------------------------------------

type Shape = 'A' | 'B' | 'C'
type Naming = 'first-cut' | 'every' | 'chats'

const SHAPES: { key: Shape; label: string; line: string }[] = [
  { key: 'A', label: 'A · Epics', line: 'epics' },
  { key: 'B', label: 'B · Lanes + tags', line: 'lanes + tags' },
  { key: 'C', label: 'C · Hybrid', line: 'hybrid' },
]
const NAMINGS: { key: Naming; label: string; line: string }[] = [
  { key: 'every', label: 'Epics, every chat named', line: 'every chat named' },
  { key: 'first-cut', label: 'Epics, named at first cut', line: 'epics named at first cut' },
  { key: 'chats', label: 'Chats', line: 'chats' },
]

const params = new URLSearchParams(location.search)
const pick = <T extends string>(name: string, of: readonly T[], fallback: T): T => {
  const v = params.get(name)
  return of.find((x) => x === v) ?? fallback
}

interface Choice {
  state: StateKey
  shape: Shape
  naming: Naming
}

function address(c: Choice): string {
  const q = new URLSearchParams({ state: c.state })
  if (c.shape !== 'A') q.set('shape', c.shape)
  if (c.naming !== 'every') q.set('naming', c.naming)
  return `?${q.toString()}`
}

/** The naming Tweak applied to a sample: question chats name themselves in epic style. */
function named(s: Sample, naming: Naming): Sample {
  if (naming !== 'every') return s
  const rename = (c: ThreadEntry): ThreadEntry => ({ ...c, title: EVERY_CHAT_NAMED[c.title] ?? c.title })
  return { ...s, epics: s.epics.map((e) => ({ ...e, chat: rename(e.chat) })) }
}

/** What the screen calls a chat, by the naming Tweak. */
function nounOf(naming: Naming): 'epic' | 'chat' {
  return naming === 'chats' ? 'chat' : 'epic'
}

// ---------------------------------------------------------------------------
// Shared rows
// ---------------------------------------------------------------------------

const featureActions = (): FeatureAction[] => [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]
const epicActions = (): FeatureAction[] => [
  { key: 'rename', label: 'Rename…', icon: <IconPencil />, onSelect: noop },
  { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
]

/** Every feature in motion in the sample, with its epic and who runs it. */
function allInMotion(s: Sample): { f: FeatureListItem; epic: string | null; holder: EpicHolder | null }[] {
  return [
    ...s.epics.flatMap((e) => e.features.map((x) => ({ f: x.feature, epic: e.chat.title, holder: x.holder }))),
    ...s.other.map((f) => ({ f, epic: null, holder: null })),
  ]
}

/** A feature row tagged with its epic, as shapes B and C draw it outside an epic. */
function taggedWords(f: FeatureListItem, epic: string | null, holder: EpicHolder | null): string {
  if (!epic || !holder) return featureStateWords(f)
  // Outside its epic there is no question above: the row keeps its own words.
  const words = nestedFeatureWords(featureStateWords(f), holder, epic)
  return `${epic} · ${words === 'Question above' ? 'asking you' : words.replace(/^Asking above · /, 'Asking · ')}`
}

/** The shelves at the foot, their rows naming their epic (decisions 9, 21). */
function Shelves({ s, open, onOpen, upNext }: { s: Sample; open: Open; onOpen: (o: Open) => void; upNext?: ReactNode }) {
  const epicOf = new Map([...s.backlog, ...s.shipped, ...s.archived].map((x) => [x.feature.id, x.epic]))
  const row = (f: FeatureListItem) => (
    <SidebarFeatureRow
      key={f.id}
      f={f}
      active={open.kind === 'feature' && open.id === f.id}
      onSelect={(id) => onOpen({ kind: 'feature', id })}
      actions={featureActions()}
      words={shelfFeatureWords(f, featureStateWords(f), epicOf.get(f.id) ?? null)}
    />
  )
  const features = (xs: Shelved[]) => xs.map((x) => x.feature)
  return (
    <div className="flex flex-col divide-y divide-border-subtle">
      {upNext}
      <Shelf icon={<IconList />} label="Backlog" features={features(s.backlog)} renderRow={row} />
      <Shelf icon={<IconGitMerge />} label="Shipped" features={features(s.shipped)} renderRow={row} cap={5} />
      <Shelf icon={<IconArchive />} label="Archived" features={features(s.archived)} renderRow={row} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shape A — the epic list (the component)
// ---------------------------------------------------------------------------

function ShapeA({ s, naming, open, onOpen }: { s: Sample; naming: Naming; open: Open; onOpen: (o: Open) => void }) {
  return (
    <>
      <SidebarEpics
        epics={s.epics}
        other={s.other}
        total={s.total}
        currentChat={open.kind === 'epic' ? open.id : null}
        currentFeature={open.kind === 'feature' ? open.id : null}
        onOpenEpic={(id) => onOpen({ kind: 'epic', id })}
        onSelectFeature={(id) => onOpen({ kind: 'feature', id })}
        onAllEpics={noop}
        epicActions={epicActions}
        featureActions={featureActions}
        noun={nounOf(naming)}
      />
      <Shelves s={s} open={open} onOpen={onOpen} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Shape B — today's lanes, each row tagged with its epic; the chats card kept
// ---------------------------------------------------------------------------

function ShapeBCard({ s, naming, open, onOpen }: { s: Sample; naming: Naming; open: Open; onOpen: (o: Open) => void }) {
  const chats = [...s.epics.map((e) => e.chat)].sort((a, b) => b.createdAt - a.createdAt)
  const asking = chats.filter((c) => c.state === 'waiting').length
  const working = chats.filter((c) => c.state === 'working').length
  const status = [asking > 0 ? `${asking} asking you` : null, working > 0 ? `${working} working` : null].filter(Boolean).join(' · ') || 'Quiet'
  const many = naming === 'chats' ? 'Chats' : 'Epics'
  return (
    <OrchestratorCard
      name={many}
      status={status}
      state={asking > 0 ? 'waiting' : working > 0 ? 'working' : 'idle'}
      active={false}
      onOpen={noop}
      actions={[]}
      onNewThread={noop}
      threads={
        chats.length > 0 ? (
          <SidebarThreadList
            label={many}
            threads={chats}
            current={open.kind === 'epic' ? open.id : null}
            onOpen={(id) => onOpen({ kind: 'epic', id })}
            actionsFor={epicActions}
            keep={() => true}
            more={noop}
          />
        ) : undefined
      }
    />
  )
}

function ShapeB({ s, open, onOpen }: { s: Sample; open: Open; onOpen: (o: Open) => void }) {
  const all = allInMotion(s)
  const tagOf = new Map(all.map((x) => [x.f.id, x]))
  const { inbox, lanes } = sidebarLanes(all.map((x) => x.f))
  const lane = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
  const row = (f: FeatureListItem, nested = false) => {
    const t = tagOf.get(f.id)
    return (
      <SidebarFeatureRow
        key={f.id}
        f={f}
        active={open.kind === 'feature' && open.id === f.id}
        onSelect={(id) => onOpen({ kind: 'feature', id })}
        actions={featureActions()}
        nested={nested}
        words={taggedWords(f, t?.epic ?? null, t?.holder ?? null)}
      />
    )
  }
  return (
    <>
      {inbox.length + lane('inProgress').length > 0 && (
        <section aria-label="Needs you" className="flex flex-col gap-1">
          {inbox.map((f) => row(f))}
          {lane('inProgress').map((f) => row(f))}
        </section>
      )}
      <WorkingShelf features={lane('agentWorking')} renderRow={row} />
      <Shelves
        s={s}
        open={open}
        onOpen={onOpen}
        upNext={<Shelf icon={<IconClock />} label="Up next" features={lane('upNext')} renderRow={(f) => row(f)} defaultOpen />}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Shape C — a Needs-you strip on top, then the epics holding the rest
// ---------------------------------------------------------------------------

function ShapeC({ s, naming, open, onOpen }: { s: Sample; naming: Naming; open: Open; onOpen: (o: Open) => void }) {
  // Each item in one place: what is yellow lives in the strip, the rest under its epic.
  const askingChats = s.epics.filter((e) => e.chat.state === 'waiting')
  const yellowFeatures = allInMotion(s).filter((x) => featureIsYellow(x.f))
  const calm: Epic[] = s.epics.map((e) => ({
    ...e,
    chat: e.chat.state === 'waiting' ? { ...e.chat, state: 'idle' } : e.chat,
    asksAbout: null,
    features: e.features.filter((x) => !featureIsYellow(x.feature)),
  }))
  const strip = askingChats.length + yellowFeatures.length > 0
  return (
    <>
      {strip && (
        <section aria-label="Needs you" className="flex flex-col gap-1">
          <SectionLabel className="px-2.5">Needs you</SectionLabel>
          {askingChats.map((e) => (
            <SidebarEpicRow
              key={e.chat.id}
              chat={e.chat}
              asksAbout={e.asksAbout}
              active={open.kind === 'epic' && open.id === e.chat.id}
              onOpen={(id) => onOpen({ kind: 'epic', id })}
              actions={epicActions()}
            />
          ))}
          {yellowFeatures.map((x) => (
            <SidebarFeatureRow
              key={x.f.id}
              f={x.f}
              active={open.kind === 'feature' && open.id === x.f.id}
              onSelect={(id) => onOpen({ kind: 'feature', id })}
              actions={featureActions()}
              words={taggedWords(x.f, x.epic, x.holder)}
            />
          ))}
        </section>
      )}
      <ShapeA s={{ ...s, epics: calm, other: s.other.filter((f) => !featureIsYellow(f)) }} naming={naming} open={open} onOpen={onOpen} />
    </>
  )
}

// ---------------------------------------------------------------------------
// The sidebar
// ---------------------------------------------------------------------------

/** The Create menu with the naming Tweak's word: "New epic" (decision 14) or "New chat". */
function DesignCreateMenu({ noun }: { noun: 'epic' | 'chat' }) {
  const items: { icon: ReactNode; label: string; hint: string; kbd?: string }[] = [
    {
      icon: <IconMessage />,
      label: `New ${noun}`,
      hint: noun === 'epic' ? 'A new chat with the orchestrator — an idea, a question, the features it becomes' : 'A new chat with the orchestrator — talk an idea through before it becomes a feature',
    },
    { icon: <IconDoc />, label: 'Add to backlog', hint: 'Write an idea down now, work it out later' },
    { icon: <IconPencil />, label: 'Jot a note', hint: 'What you just noticed — triage it later', kbd: shortcut('J') },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Create" size="sm" icon={<IconPencil />} tooltipSide="bottom" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {items.map((it) => (
          <DropdownMenuItem key={it.label} className="items-start py-1.5 [&>svg]:mt-0.5" icon={it.icon} onSelect={noop}>
            <span className="min-w-0 flex-1">
              <span className="block">{it.label}</span>
              <span className="block text-xs text-pretty text-text-tertiary">{it.hint}</span>
            </span>
            {it.kbd && <Kbd className="mt-0.5">{it.kbd}</Kbd>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DesignSidebar({ choice, s, open, onOpen, phone }: { choice: Choice; s: Sample; open: Open; onOpen: (o: Open) => void; phone: boolean }) {
  const theme = useTheme()
  const noun = nounOf(choice.naming)
  return (
    <nav aria-label="Project" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarBackdrop />
      {phone ? (
        <div className="flex h-11 shrink-0 items-center gap-1 px-1">
          <div className="flex min-w-0 flex-1">
            <ProjectSwitcher nav={nav} />
          </div>
          {/* The list's own "+" is New epic, so the head keeps the Create menu, not a second "+". */}
          <DesignCreateMenu noun={noun} />
        </div>
      ) : (
        <div className="flex h-10 shrink-0 items-center gap-0.5">
          <div className="flex min-w-0 flex-1">
            <ProjectSwitcher nav={nav} />
          </div>
          <IconButton label="Search or jump to" kbd={shortcut('K')} size="sm" icon={<IconSearch />} tooltipSide="bottom" />
          <DesignCreateMenu noun={noun} />
          <CollapseSidebarButton />
        </div>
      )}
      {choice.shape === 'B' && (
        <div className={phone ? 'mt-2' : 'mt-3'}>
          <ShapeBCard s={s} naming={choice.naming} open={open} onOpen={onOpen} />
        </div>
      )}
      <div
        className={cx(
          '-mx-2 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]',
          choice.shape === 'B' ? 'mt-4' : 'mt-3',
        )}
      >
        {choice.shape === 'A' && <ShapeA s={s} naming={choice.naming} open={open} onOpen={onOpen} />}
        {choice.shape === 'B' && <ShapeB s={s} open={open} onOpen={onOpen} />}
        {choice.shape === 'C' && <ShapeC s={s} naming={choice.naming} open={open} onOpen={onOpen} />}
      </div>
      {!phone && (
        <div className="flex shrink-0 flex-col gap-2 pt-2">
          <SidebarStatusLine
            healthTone="success"
            healthTip="Server ok — live updates streaming"
            sandbox="docker"
            notify={{ state: 'on', title: '', onToggle: noop }}
            theme={theme.resolved}
            onToggleTheme={theme.toggle}
            onOpenSettings={noop}
          />
        </div>
      )}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// The content panel: a placeholder, its crumb naming the epic (decision 15)
// ---------------------------------------------------------------------------

function findOpen(s: Sample, open: Open): { epic: string | null; feature: FeatureListItem | null; holder: EpicHolder | null } {
  if (open.kind === 'epic') return { epic: s.epics.find((e) => e.chat.id === open.id)?.chat.title ?? null, feature: null, holder: null }
  const epic = s.epics.find((e) => e.features.some((x) => x.feature.id === open.id))
  if (epic) {
    const x = epic.features.find((y) => y.feature.id === open.id)!
    return { epic: epic.chat.title, feature: x.feature, holder: x.holder }
  }
  const loose = s.other.find((f) => f.id === open.id)
  if (loose) return { epic: null, feature: loose, holder: { kind: 'you' } }
  const shelved = [...s.backlog, ...s.shipped, ...s.archived].find((x) => x.feature.id === open.id)
  return { epic: shelved?.epic ?? null, feature: shelved?.feature ?? null, holder: shelved ? { kind: 'you' } : null }
}

/**
 * The header's epic and owner (decision 15, as the orchestrator changed it):
 * one crumb when the epic's chat owns the feature ("Payment System · you
 * merge ▾"), two when the human or another chat does, the owner alone with no epic.
 */
function headerCrumbs(epic: string | null, holder: EpicHolder | null): Crumb[] {
  if (!holder) return epic ? [{ label: epic, icon: <EpicGlyph small /> }] : []
  const owner: FeatureOwner =
    holder.kind === 'you'
      ? { kind: 'you' }
      : { kind: 'chat', name: holder.kind === 'epic' ? epic ?? '' : holder.title, finish: 'show' }
  const control = (inEpic: boolean) => (
    <OwnerControl owner={owner} {...(epic ? { chatName: epic } : {})} inEpic={inEpic} onChoose={noop} />
  )
  if (!epic) return [{ label: control(false) }]
  if (holder.kind !== 'epic') return [{ label: epic, icon: <EpicGlyph small />, onClick: noop }, { label: control(false) }]
  return [
    {
      icon: <EpicGlyph small />,
      label: (
        <span className="inline-flex min-w-0 items-center">
          <button type="button" className="block max-w-44 cursor-pointer truncate rounded-md hover:text-text">
            {epic}
          </button>
          <span aria-hidden="true" className="pl-1 text-text-tertiary">
            ·
          </span>
          {control(true)}
        </span>
      ),
    },
  ]
}

function Panel({ s, open }: { s: Sample; open: Open }) {
  const { epic, feature, holder } = findOpen(s, open)
  const crumbs: Crumb[] = [
    ...headerCrumbs(epic, feature ? holder : null),
    ...(feature ? [{ label: feature.title, icon: <FeatureProgressIcon f={feature} size={14} label="" /> }] : []),
  ]
  return (
    <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <PageTopbar
        crumbs={crumbs}
        actions={
          <>
            <IconButton size="md" label="More" icon={<IconMore />} />
            <IconButton size="md" label="Panel" icon={<IconPanelRight />} />
          </>
        }
      />
      <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-pretty text-text-tertiary">
        {feature ? `${feature.title}: the feature's lead chat` : epic ? `${epic}: the epic's chat` : 'The page in front'}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The design page's own controls
// ---------------------------------------------------------------------------

function DesignPanel({ choice, onPick }: { choice: Choice; onPick: (c: Choice) => void }) {
  const theme = useTheme()
  const phone = useIsPhone()
  const [open, setOpen] = useState(params.get('panel') !== 'folded' && !phone)
  const [tweaks, setTweaks] = useState(params.get('tweaks') !== 'folded')
  const pill = (on: boolean) =>
    on
      ? 'h-6 cursor-pointer rounded-md bg-surface-selected px-2 text-left text-text'
      : 'h-6 cursor-pointer rounded-md px-2 text-left hover:bg-surface-hover hover:text-text-secondary'
  const line = `state ${choice.state} · shape ${SHAPES.find((x) => x.key === choice.shape)!.line} · naming ${NAMINGS.find((x) => x.key === choice.naming)!.line}`
  return (
    <div
      style={{ position: 'fixed', right: 12, top: phone ? undefined : 56, bottom: phone ? 12 : undefined, width: open ? 268 : undefined, zIndex: 1000 }}
      className="flex flex-col gap-1 rounded-lg bg-surface-raised p-1 text-xs text-text-tertiary shadow-popover"
    >
      <button type="button" onClick={() => setOpen(!open)} className={pill(false)}>
        Design · states {open ? '–' : '+'}
      </button>
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {STATES.map((s) => (
              <button key={s.key} type="button" aria-pressed={s.key === choice.state} onClick={() => onPick({ ...choice, state: s.key })} className={pill(s.key === choice.state)}>
                {s.label}
              </button>
            ))}
            <button type="button" onClick={theme.toggle} className={pill(false)}>
              {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
          </div>
          <div className="border-t border-border-subtle pt-1">
            <button type="button" onClick={() => setTweaks(!tweaks)} className={pill(false)}>
              Tweaks {tweaks ? '–' : '+'}
            </button>
            {tweaks && (
              <div className="flex flex-col gap-2 px-2 pt-1 pb-1">
                <div className="flex flex-col gap-1">
                  <span>Shape</span>
                  <div className="flex flex-wrap gap-1">
                    {SHAPES.map((x) => (
                      <button key={x.key} type="button" aria-pressed={x.key === choice.shape} onClick={() => onPick({ ...choice, shape: x.key })} className={pill(x.key === choice.shape)}>
                        {x.label}
                        {x.key === 'A' && ' (rec.)'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span>Naming</span>
                  <div className="flex flex-col items-start gap-1">
                    {NAMINGS.map((x) => (
                      <button key={x.key} type="button" aria-pressed={x.key === choice.naming} onClick={() => onPick({ ...choice, naming: x.key })} className={pill(x.key === choice.naming)}>
                        {x.label}
                        {x.key === 'every' && ' (rec.)'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="m-0 font-mono text-pretty select-all">{line}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Page() {
  const [choice, setChoice] = useState<Choice>(() => ({
    state: pick('state', STATES.map((s) => s.key), 'busy'),
    shape: pick('shape', SHAPES.map((s) => s.key), 'A'),
    naming: pick('naming', NAMINGS.map((s) => s.key), 'every'),
  }))
  const base = useMemo(() => STATES.find((s) => s.key === choice.state)!.make(), [choice.state])
  const sample = named(base, choice.naming)
  const [opened, setOpened] = useState<{ state: StateKey; open: Open } | null>(null)
  const open = opened && opened.state === choice.state ? opened.open : sample.open
  const phone = useIsPhone()
  const go = (c: Choice) => {
    setChoice(c)
    history.replaceState(null, '', address(c))
  }
  const onOpen = (o: Open) => setOpened({ state: choice.state, open: o })
  return (
    <div className="flex h-dvh bg-canvas">
      <div className={cx('flex h-full shrink-0 flex-col', phone ? 'w-full' : 'w-[248px]')}>
        <DesignSidebar choice={choice} s={sample} open={open} onOpen={onOpen} phone={phone} />
      </div>
      {!phone && <Panel s={sample} open={open} />}
      <DesignPanel choice={choice} onPick={go} />
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
