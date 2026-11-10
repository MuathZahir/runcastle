import { StrictMode, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx, IconButton, Kbd, Sheet, SheetRow } from '../src/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../src/ui/dropdown-menu'
import { PopoverContent } from '../src/ui/popover'
import { CollapseSidebarButton } from '../src/components/Frame'
import { featureStateWords, Shelf, SidebarBackdrop, SidebarBackdropDrawn, SidebarFeatureRow, SidebarHead, SidebarStatusLine } from '../src/components/SidebarParts'
import { EpicGlyph, SidebarEpics } from '../src/components/SidebarEpics'
import { EpicLookPicker } from '../src/components/EpicLookPicker'
import { DesktopRail, PhoneRail, ProjectRailContext, type ProjectRailApi } from '../src/components/ProjectRail'
import { IconArchive, IconDoc, IconGitMerge, IconList, IconMore, IconPanelRight, IconPencil, IconPlus, IconSearch } from '../src/icons'
import { EpicIcon, type EpicColor, type EpicIconId } from '../src/lib/epic-look'
import type { Epic } from '../src/lib/feature-ui/epics'
import type { FeatureListItem } from '../src/lib/api'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import { shortcut } from '../src/lib/platform'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { useIsPhone } from '../src/lib/use-phone'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { makeDeadEnd } from './project-switching/design-panel'
import { RAIL_TILES, STATES, type Sample, type StateKey } from './epics-alive-data'

/**
 * Epics that look alive (docs/features/epics-that-look-alive): the sidebar
 * column — the project rail with the runcastle mark, the head, the epic list
 * with its dotted New epic slot, coloured epics and slim idle rows, the
 * shelves — over sample data, at a fixed 400px sidebar. The rail, the head,
 * the slot, the card, the slim row and the picker are the real components.
 *
 * States: ?state=mixed | all-idle | new-epic | picker | phone.
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

const noop = () => {}

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((x) => x.key === params.get('state'))?.key ?? 'mixed'

/** The sidebar's width on this page: one realistic, roomy width. */
const SIDEBAR_W = 400

// ---------------------------------------------------------------------------
// Rows and menus
// ---------------------------------------------------------------------------

const featureActions = (): FeatureAction[] => [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]
const epicActions = (): FeatureAction[] => [
  { key: 'rename', label: 'Rename…', icon: <IconPencil />, onSelect: noop },
  { key: 'look', label: 'Colour and icon…', icon: <EpicIcon icon="palette" size={14} />, onSelect: noop },
  { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
]

/** The Create menu less "New epic", which is the slot now (decision 5). */
function DesignCreateMenu() {
  const items: { icon: ReactNode; label: string; hint: string; kbd?: string }[] = [
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

// ---------------------------------------------------------------------------
// The epic list and the shelves
// ---------------------------------------------------------------------------

function EpicList({ s, open, newOpen, onNew }: { s: Sample; open: string | null; newOpen: boolean; onNew: () => void }) {
  return (
    <SidebarEpics
      epics={s.epics}
      total={s.total}
      currentChat={open}
      currentFeature={null}
      onOpenEpic={noop}
      onSelectFeature={noop}
      onAllEpics={noop}
      epicActions={epicActions}
      featureActions={featureActions}
      onNewEpic={onNew}
      newEpicOpen={newOpen}
    />
  )
}

function Shelves({ s }: { s: Sample }) {
  const row = (f: FeatureListItem) => (
    <SidebarFeatureRow key={f.id} f={f} active={false} onSelect={noop} actions={featureActions()} words={featureStateWords(f)} />
  )
  return (
    <div className="flex flex-col divide-y divide-border-subtle">
      <Shelf icon={<IconList />} label="Backlog" features={s.backlog} renderRow={row} />
      <Shelf icon={<IconGitMerge />} label="Shipped" features={s.shipped} renderRow={row} cap={5} />
      <Shelf icon={<IconArchive />} label="Archived" features={s.archived} renderRow={row} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The head
// ---------------------------------------------------------------------------

function Head({ phone }: { phone: boolean }) {
  return (
    <SidebarHead name="runcastle" phone={phone}>
      {phone ? (
        <PhoneCreate />
      ) : (
        <>
          <IconButton label="Search or jump to" kbd={shortcut('K')} size="sm" icon={<IconSearch />} tooltipSide="bottom" />
          <DesignCreateMenu />
          <CollapseSidebarButton />
        </>
      )}
    </SidebarHead>
  )
}

/** The phone head's "+": a note and the Glossary; New epic is the slot now (decision 5). */
function PhoneCreate() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton label="New" size="lg" icon={<IconPlus />} onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} label="New">
        <SheetRow icon={<IconPencil />} label="Jot a note" hint="What you just noticed — triage it later" onClick={() => setOpen(false)} />
        <SheetRow icon={<IconList />} label="Glossary" hint="The words runcastle uses, in one sentence each" onClick={() => setOpen(false)} />
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------------------
// The rail's data
// ---------------------------------------------------------------------------

/** A fake rail the real rail reads. */
function useRail(): ProjectRailApi {
  const [currentId, setCurrent] = useState<string | null>('proj_1')
  const [order, setOrder] = useState(RAIL_TILES.map((t) => t.id))
  return useMemo(() => {
    const byId = new Map(RAIL_TILES.map((t) => [t.id, t]))
    const tiles = order.flatMap((id, i) => {
      const t = byId.get(id)
      return t ? [{ ...t, shortcut: i + 1, needsYou: t.needsYou && id !== currentId }] : []
    })
    return { tiles, currentId, enter: setCurrent, goHome: () => setCurrent(null), open: noop, reorder: setOrder }
  }, [currentId, order])
}

// ---------------------------------------------------------------------------
// The picker, held open on an epic
// ---------------------------------------------------------------------------

function PickerOn({ epic }: { epic: Epic }) {
  const [color, setColor] = useState<EpicColor>(epic.color ?? 'blue')
  const [icon, setIcon] = useState<EpicIconId | null>(epic.icon ?? null)
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => document.querySelector(`[data-epic="${epic.chat.id}"]`)?.getBoundingClientRect() ?? new DOMRect(),
      },
    }),
    [epic.chat.id],
  )
  // The anchor is read after the list has painted.
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => setReady(true), [])
  if (!ready) return null
  return (
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Anchor virtualRef={anchor} />
      <PopoverContent side="right" align="start" sideOffset={10} className="p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <EpicLookPicker color={color} icon={icon} onColor={setColor} onIcon={setIcon} />
      </PopoverContent>
    </PopoverPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// The sidebar, the panel stand-in
// ---------------------------------------------------------------------------

function DesignSidebar({ s, phone, newOpen, onNew }: { s: Sample; phone: boolean; newOpen: boolean; onNew: () => void }) {
  const theme = useTheme()
  return (
    <nav aria-label="Project" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarBackdrop />
      {phone && <PhoneRail />}
      <Head phone={phone} />
      <div className="-mx-2 mt-3 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
        <EpicList s={s} open={phone || newOpen ? null : s.openChat} newOpen={newOpen} onNew={onNew} />
        <Shelves s={s} />
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

function Panel({ s, newOpen }: { s: Sample; newOpen: boolean }) {
  const epic = newOpen ? null : s.epics.find((e) => e.chat.id === s.openChat)
  return (
    <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-sm text-text-secondary">
        {epic ? (
          <>
            <EpicGlyph small color={epic.color} icon={epic.icon} />
            <span className="truncate">{epic.chat.title}</span>
          </>
        ) : (
          <>
            <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-sm border border-dashed border-border-strong text-text-tertiary">
              <IconPlus size={10} />
            </span>
            <span>New epic</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-1">
          <IconButton size="md" label="More" icon={<IconMore />} />
          <IconButton size="md" label="Panel" icon={<IconPanelRight />} />
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-8 text-center text-sm text-pretty text-text-tertiary">
        {epic ? (
          `${epic.chat.title}: the epic's chat`
        ) : (
          <>
            <span className="text-text-secondary">An empty epic chat</span>
            <span>It joins the list when you send the first message.</span>
          </>
        )}
      </div>
      {!epic && (
        <div className="p-3">
          <div className="flex h-11 items-center rounded-lg bg-fill-card px-3 text-sm text-text-tertiary shadow-[inset_0_0_0_1px_var(--color-border)]">
            What do you want to work on?
          </div>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The design page's own controls
// ---------------------------------------------------------------------------

function DesignPanel({ state, onPick }: { state: StateKey; onPick: (s: StateKey) => void }) {
  const theme = useTheme()
  const phone = useIsPhone()
  const [open, setOpen] = useState(params.get('panel') !== 'folded' && !phone)
  const pill = (on: boolean) =>
    cx('h-6 cursor-pointer rounded-md px-2 text-left whitespace-nowrap', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover hover:text-text-secondary')
  if (!open) {
    return (
      <button
        type="button"
        data-design-panel
        onClick={() => setOpen(true)}
        style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 1000 }}
        className="h-7 cursor-pointer rounded-md border border-dashed border-border-strong bg-surface-raised px-2.5 font-mono text-xs text-text-tertiary shadow-popover"
      >
        Design · states
      </button>
    )
  }
  return (
    <div
      data-design-panel
      style={{ position: 'fixed', right: 12, bottom: 12, width: 320, zIndex: 1000 }}
      className="flex flex-col gap-1 rounded-lg border border-dashed border-border-strong bg-surface-raised p-1.5 text-xs text-text-tertiary shadow-popover"
    >
      <div className="flex items-center px-1.5 pt-0.5">
        <span className="font-mono text-text-secondary">Design · states</span>
        <button type="button" onClick={() => setOpen(false)} className={cx(pill(false), 'ml-auto')}>
          Hide
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {STATES.map((s) => (
          <button key={s.key} type="button" aria-pressed={s.key === state} onClick={() => onPick(s.key)} className={pill(s.key === state)}>
            {s.label}
          </button>
        ))}
        <button type="button" onClick={theme.toggle} className={cx(pill(false), 'ml-auto')}>
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      <p className="m-0 px-2 pb-0.5 leading-4">{STATES.find((s) => s.key === state)!.hint}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Page() {
  const [state, setState] = useState<StateKey>(pickState)
  const sample = useMemo(() => STATES.find((s) => s.key === state)!.make(), [state])
  const [pressed, setPressed] = useState<StateKey | null>(null)
  const newOpen = state === 'new-epic' || pressed === state
  const isPhone = useIsPhone()
  const rail = useRail()
  const go = (next: StateKey) => {
    setState(next)
    setPressed(null)
    history.replaceState(null, '', `?${new URLSearchParams({ state: next }).toString()}`)
  }
  const onNew = () => setPressed(state)
  const phoneFrame = state === 'phone' || isPhone
  const pickerEpic = state === 'picker' ? sample.epics.find((e) => e.chat.title === 'Epic Rail Polish') : undefined
  return (
    <ProjectRailContext.Provider value={rail}>
      {phoneFrame ? (
        <div className={cx('flex h-dvh justify-center', isPhone ? 'bg-canvas' : 'items-center bg-[color-mix(in_oklab,var(--color-canvas)_70%,black)]')}>
          <div
            className={cx('flex h-full flex-col overflow-hidden bg-canvas', !isPhone && 'my-6 h-[844px] max-h-[calc(100dvh-48px)] rounded-[28px] shadow-[0_0_0_1px_var(--color-border)]')}
            style={{ width: isPhone ? '100%' : 390 }}
          >
            <DesignSidebar s={sample} phone newOpen={newOpen} onNew={onNew} />
          </div>
        </div>
      ) : (
        <div className="flex h-dvh bg-canvas">
          <div className="relative isolate flex h-full shrink-0">
            <SidebarBackdrop />
            <DesktopRail />
            <SidebarBackdropDrawn.Provider value>
              <div className="flex h-full shrink-0 flex-col" style={{ width: SIDEBAR_W }}>
                <DesignSidebar s={sample} phone={false} newOpen={newOpen} onNew={onNew} />
              </div>
            </SidebarBackdropDrawn.Provider>
          </div>
          <Panel s={sample} newOpen={newOpen} />
          {pickerEpic && <PickerOn epic={pickerEpic} />}
        </div>
      )}
      <DesignPanel state={state} onPick={go} />
    </ProjectRailContext.Provider>
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
