import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx, IconButton } from '../src/ui'
import { CollapseSidebarButton } from '../src/components/Frame'
import { featureStateWords, Shelf, SidebarBackdrop, SidebarBackdropDrawn, SidebarFeatureRow, SidebarHead, SidebarStatusLine } from '../src/components/SidebarParts'
import { SidebarEpics } from '../src/components/SidebarEpics'
import { AutopilotMark } from '../src/components/autopilot/AutopilotParts'
import { DesktopRail, PhoneRail, ProjectRailContext, type ProjectRailApi } from '../src/components/ProjectRail'
import { IconArchive, IconDoc, IconGitMerge, IconList, IconMore, IconPanelRight, IconPencil, IconPlus, IconSearch } from '../src/icons'
import { EpicIcon } from '../src/lib/epic-look'
import type { FeatureListItem } from '../src/lib/api'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import { shortcut } from '../src/lib/platform'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { useIsPhone } from '../src/lib/use-phone'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { useDesignReport, useDesignTweaks } from '../../../.runcastle/preview/design-report'
import { DesignPanel, makeDeadEnd, type TweakSpec } from './autopilot-design-panel'
import { RAIL_TILES, STATES, type Sample, type StateKey } from './autopilot-sidebar-data'

/**
 * Sidebar on autopilot (docs/features/epics-on-autopilot decisions 7, 14, 17):
 * the sidebar column with the epic "Checkout flow" off and on autopilot beside
 * ordinary epics. The rail, the head, the epic list, the cards, the rows and
 * the shelves are the real components; the autopilot looks the Tweaks switch
 * between are this page's own stylesheet over the card's `data-autopilot`.
 *
 * States: ?state=off | on | needs-you | partial | phone.
 * Tweaks: "Autopilot look" (edge | scan | rail), "Locked mark" (lock | autopilot).
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

const noop = () => {}

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((x) => x.key === params.get('state'))?.key ?? 'on'

/** A realistic sidebar: a little past the 248 default, as most people drag it. */
const SIDEBAR_W = 288

const TWEAKS: TweakSpec[] = [
  {
    name: 'look',
    label: 'Autopilot look',
    options: [
      { value: 'edge', label: 'Moving edge' },
      { value: 'scan', label: 'Scanlines' },
      { value: 'rail', label: 'Tinted rail' },
    ],
  },
  {
    name: 'mark',
    label: 'Locked mark',
    options: [
      { value: 'lock', label: 'Lock' },
      { value: 'autopilot', label: 'Autopilot glyph' },
    ],
  },
]

type Tweaks = { look: string; mark: string }

// ---------------------------------------------------------------------------
// The autopilot looks: a stylesheet over the card's data-autopilot. Only the
// epic's own colour (--epic, --epic-text), theme tokens, and motion that the
// reduced-motion rule below stills.
// ---------------------------------------------------------------------------

const RING = 'inset 0 0 0 1px color-mix(in oklab, var(--epic) 34%, transparent)'

/** The halo outside the card: the epic's colour, soft, all round. */
const HALO = '0 0 0 1px color-mix(in oklab, var(--epic) 14%, transparent), 0 0 26px -8px color-mix(in oklab, var(--epic) 60%, transparent)'

/* What both bright looks share: the head's wash a step brighter, and the rows
   under it faintly in the epic's colour, so the card reads as one machine. */
const LIT = `
  [data-autopilot] > [data-epic] {
    background: linear-gradient(100deg, color-mix(in oklab, var(--epic) 26%, var(--color-canvas)), color-mix(in oklab, var(--epic) 8%, var(--color-canvas)) 80%);
  }
  [data-autopilot] > [data-epic] + div {
    background: linear-gradient(to bottom, color-mix(in oklab, var(--epic) 6%, transparent), transparent 70%);
  }
`

const LOOKS: Record<string, string> = {
  /* A light travels the card's edge in the epic's colour, over a tinted
     hairline, with a soft drop of the same colour under it. When the epic
     waits on you the light stops: the edge is evenly lit. */
  edge: `
    ${LIT}
    [data-autopilot] {
      box-shadow: ${RING}, ${HALO};
    }
    [data-autopilot]::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 1;
      border-radius: inherit;
      padding: 1.5px;
      pointer-events: none;
      background: conic-gradient(
        from var(--orbit-angle),
        transparent 0 52%,
        color-mix(in oklab, var(--epic) 55%, transparent) 72%,
        var(--epic-text) 80%,
        color-mix(in oklab, var(--epic) 55%, transparent) 85%,
        transparent 96%
      );
      mask: linear-gradient(black 0 0) content-box exclude, linear-gradient(black 0 0);
      animation: orbit 5s linear infinite;
    }
    [data-autopilot][data-autopilot-state='asking']::after {
      animation: none;
      background: color-mix(in oklab, var(--epic) 55%, transparent);
    }
    @media (prefers-reduced-motion: reduce) {
      [data-autopilot]::after { background: color-mix(in oklab, var(--epic) 55%, transparent); }
    }
  `,
  /* Fine scanlines over the card, fading down, a soft inner glow, and a slow
     scan band passing top to bottom while the epic works. */
  scan: `
    ${LIT}
    [data-autopilot] {
      box-shadow: ${RING}, inset 0 0 22px -8px color-mix(in oklab, var(--epic) 55%, transparent), ${HALO};
    }
    [data-autopilot]::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      background: repeating-linear-gradient(to bottom, color-mix(in oklab, var(--epic) 12%, transparent) 0 1px, transparent 1px 3px);
      mask-image: linear-gradient(to bottom, black, transparent 85%);
    }
    [data-autopilot]::after {
      content: '';
      position: absolute;
      inset-inline: 0;
      top: 0;
      height: 45%;
      z-index: 1;
      pointer-events: none;
      background: linear-gradient(to bottom, transparent, color-mix(in oklab, var(--epic) 12%, transparent) 80%, color-mix(in oklab, var(--epic-text) 50%, transparent) 99%, transparent);
      transform: translateY(-110%);
      animation: autopilotScan 4.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
    }
    [data-autopilot][data-autopilot-state='asking']::after { display: none; }
    @keyframes autopilotScan { 0% { transform: translateY(-110%); } 65%, 100% { transform: translateY(240%); } }
    @media (prefers-reduced-motion: reduce) {
      [data-autopilot]::after { display: none; }
    }
  `,
  /* Quiet: the epic's colour as a rail down the card's left edge, the whole
     card faintly tinted, and one bead of light running down the rail. */
  rail: `
    [data-autopilot] {
      background: linear-gradient(to right, color-mix(in oklab, var(--epic) 7%, var(--color-fill-card)), var(--color-fill-card) 45%);
      box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--epic) 22%, transparent);
    }
    [data-autopilot]::before {
      content: '';
      position: absolute;
      inset-block: 0;
      left: 0;
      width: 3px;
      z-index: 1;
      pointer-events: none;
      background: linear-gradient(to bottom, var(--epic), color-mix(in oklab, var(--epic) 40%, transparent));
    }
    [data-autopilot]::after {
      content: '';
      position: absolute;
      inset-block: 0;
      left: 0;
      width: 3px;
      z-index: 1;
      pointer-events: none;
      background: linear-gradient(to bottom, transparent, var(--epic-text), transparent) no-repeat;
      background-size: 100% 36px;
      animation: autopilotBead 3.2s ease-in-out infinite;
    }
    [data-autopilot][data-autopilot-state='asking']::after { display: none; }
    @keyframes autopilotBead { from { background-position: 0 -36px; } to { background-position: 0 calc(100% + 36px); } }
    @media (prefers-reduced-motion: reduce) {
      [data-autopilot]::after { display: none; }
    }
  `,
}

// ---------------------------------------------------------------------------
// Rows and menus
// ---------------------------------------------------------------------------

const featureActions = (): FeatureAction[] => [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]
const epicActions = (): FeatureAction[] => [
  { key: 'rename', label: 'Rename…', icon: <IconPencil />, onSelect: noop },
  { key: 'look', label: 'Colour and icon…', icon: <EpicIcon icon="palette" size={14} />, onSelect: noop },
  { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
]

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

function Head({ phone }: { phone: boolean }) {
  return (
    <SidebarHead name="shopfront" phone={phone}>
      {phone ? (
        <IconButton label="New" size="lg" icon={<IconPlus />} />
      ) : (
        <>
          <IconButton label="Search or jump to" kbd={shortcut('K')} size="sm" icon={<IconSearch />} tooltipSide="bottom" />
          <IconButton label="Create" size="sm" icon={<IconPencil />} tooltipSide="bottom" />
          <CollapseSidebarButton />
        </>
      )}
    </SidebarHead>
  )
}

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
// The sidebar, the panel stand-in
// ---------------------------------------------------------------------------

function DesignSidebar({ s, phone, mark }: { s: Sample; phone: boolean; mark: string }) {
  const theme = useTheme()
  return (
    <nav aria-label="Project" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarBackdrop />
      {phone && <PhoneRail />}
      <Head phone={phone} />
      <div className="-mx-2 mt-3 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
        <SidebarEpics
          epics={s.epics}
          total={s.total}
          currentChat={s.openChat}
          currentFeature={null}
          onOpenEpic={noop}
          onSelectFeature={noop}
          onAllEpics={noop}
          epicActions={epicActions}
          featureActions={featureActions}
          onNewEpic={noop}
          {...(mark === 'autopilot' ? { lockMark: <AutopilotMark word={false} /> } : {})}
        />
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

function Panel() {
  return (
    <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-sm text-text-secondary">
        <span className="truncate">The page in front</span>
        <span className="ml-auto flex items-center gap-1">
          <IconButton size="md" label="More" icon={<IconMore />} />
          <IconButton size="md" label="Panel" icon={<IconPanelRight />} />
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-pretty text-text-tertiary">
        This page is about the sidebar.
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Page() {
  const [state, setState] = useState<StateKey>(pickState)
  const [tweaks, setTweak] = useDesignTweaks<Tweaks>({ look: 'edge', mark: 'lock' })
  useDesignReport(state, tweaks)
  const sample = useMemo(() => STATES.find((s) => s.key === state)!.make(), [state])
  const isPhone = useIsPhone()
  const rail = useRail()
  const go = (next: StateKey) => {
    setState(next)
    history.replaceState(null, '', `?${new URLSearchParams({ state: next }).toString()}`)
  }
  const phoneFrame = state === 'phone' || isPhone
  return (
    <ProjectRailContext.Provider value={rail}>
      <style>{LOOKS[tweaks.look] ?? LOOKS.edge}</style>
      {phoneFrame ? (
        <div className={cx('flex h-dvh justify-center', isPhone ? 'bg-canvas' : 'items-center bg-[color-mix(in_oklab,var(--color-canvas)_70%,black)]')}>
          <div
            className={cx('flex h-full flex-col overflow-hidden bg-canvas', !isPhone && 'my-6 h-[844px] max-h-[calc(100dvh-48px)] rounded-[28px] shadow-[0_0_0_1px_var(--color-border)]')}
            style={{ width: isPhone ? '100%' : 390 }}
          >
            <DesignSidebar s={sample} phone mark={tweaks.mark} />
          </div>
        </div>
      ) : (
        <div className="flex h-dvh bg-canvas">
          <div className="relative isolate flex h-full shrink-0">
            <SidebarBackdrop />
            <DesktopRail />
            <SidebarBackdropDrawn.Provider value>
              <div className="flex h-full shrink-0 flex-col" style={{ width: SIDEBAR_W }}>
                <DesignSidebar s={sample} phone={false} mark={tweaks.mark} />
              </div>
            </SidebarBackdropDrawn.Provider>
          </div>
          <Panel />
        </div>
      )}
      <DesignPanel
        states={STATES}
        state={state}
        onPick={go}
        tweaks={TWEAKS}
        values={tweaks}
        onTweak={(name, value) => setTweak(name as keyof Tweaks, value)}
      />
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
