import { StrictMode, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx, FailureNote } from '../src/ui'
import { StatusDot, StatusLabel } from '../src/ui/status'
import type { StatusTone } from '../src/ui/status'
import { SidebarFeatureRow } from '../src/components/SidebarParts'
import { NoticeDeck } from '../src/components/chat/NoticeDeck'
import type { ChatNotice } from '../src/lib/chat-notices'
import { IconAlert, IconCheck, IconChevronRight } from '../src/icons'
import type { FeatureListItem } from '../src/lib/api'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import type { ResolvedTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { busyFeatures, SELECTED_TITLE } from './sidebar-data'
import { contrast, GROUNDS, MARK_FLOOR, TODAY_LIGHT, TOKENS, WORD_FLOOR } from './palette-data'
import type { Ground, PaletteToken, Rgb } from './palette-data'

/**
 * The light-theme retune (docs/features/lighten-the-light-theme-s-colours),
 * judged by eye: every coloured token as marks and as words on each ground,
 * with its measured contrast, and real pieces of the app — in today's light
 * palette and in the live one, side by side. A dead end on purpose: links and
 * actions do nothing here.
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

const noop = () => {}
const rowActions: FeatureAction[] = [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]

type Palette = 'today' | 'new'

/* ---- measuring ---- */

/** A 1px canvas that turns any colour the browser computed (rgb(), color(srgb …), oklab …) into sRGB bytes. */
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })

function toRgb(css: string): Rgb {
  if (!probe) return [0, 0, 0]
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = css
  probe.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

/**
 * The contrast of an element's resolved text colour against the background of
 * the `[data-ground]` it sits in, re-measured whenever the theme switches.
 */
function useContrast(theme: ResolvedTheme) {
  const ink = useRef<HTMLSpanElement>(null)
  const [ratio, setRatio] = useState<number | null>(null)
  useLayoutEffect(() => {
    const ground = ink.current?.closest('[data-ground]')
    if (!ink.current || !ground) return
    const bg = toRgb(getComputedStyle(ground).backgroundColor)
    setRatio(contrast(toRgb(getComputedStyle(ink.current).color), bg))
  }, [theme])
  return { ink, ratio }
}

function Ratio({ value, floor }: { value: number | null; floor: number }) {
  if (value === null) return null
  const ok = value >= floor
  return (
    <span
      title={ok ? `Clears the ${floor}:1 floor` : `Under the ${floor}:1 floor`}
      className={cx(
        'inline-flex items-center gap-1 font-mono text-xs tabular-nums',
        ok ? 'text-text-tertiary' : 'font-semibold text-text',
      )}
    >
      {value.toFixed(2)}
      {ok ? <IconCheck size={12} /> : <IconAlert size={12} />}
      <span className="sr-only">{ok ? `clears ${floor}:1` : `under ${floor}:1`}</span>
    </span>
  )
}

/* ---- the token grid ---- */

/** A 6px dot, a 16px glyph and a ring in one colour, measured as a mark (3:1). */
function Marks({ color, theme }: { color: string; theme: ResolvedTheme }) {
  const { ink, ratio } = useContrast(theme)
  return (
    <div className="flex items-center gap-2">
      <span ref={ink} style={{ color }} className="inline-flex items-center gap-2">
        <span className="inline-block size-1.5 rounded-full bg-current" />
        <IconAlert size={16} />
        <span className="inline-block size-3 rounded-full border-2 border-current" />
      </span>
      <Ratio value={ratio} floor={MARK_FLOOR} />
    </div>
  )
}

/** A short sentence in one colour, measured as words (4.5:1). */
function Words({ color, theme }: { color: string; theme: ResolvedTheme }) {
  const { ink, ratio } = useContrast(theme)
  return (
    <div className="flex flex-col gap-0.5">
      <span ref={ink} style={{ color }} className="text-xs font-medium whitespace-nowrap">
        Restart the server to apply
      </span>
      <Ratio value={ratio} floor={WORD_FLOOR} />
    </div>
  )
}

const GROUND_NAME: Record<Ground, string> = {
  surface: 'Surface',
  canvas: 'Canvas',
  'surface-hover': 'Hovered row',
  'surface-selected': 'Selected row',
}

function TokenGrid({ theme }: { theme: ResolvedTheme }) {
  return (
    <div className="grid grid-cols-[150px_repeat(4,minmax(176px,1fr))] overflow-hidden rounded-lg border border-border">
      <div className="bg-surface px-3 py-2 text-xs text-text-tertiary">Token</div>
      {GROUNDS.map((g) => (
        <div key={g} className="bg-surface px-3 py-2 text-xs text-text-tertiary">
          {GROUND_NAME[g]}
        </div>
      ))}
      {TOKENS.map((token) => (
        <TokenRow key={token.name} token={token} theme={theme} />
      ))}
    </div>
  )
}

function TokenRow({ token, theme }: { token: PaletteToken; theme: ResolvedTheme }) {
  return (
    <>
      <div className="flex flex-col justify-center gap-0.5 border-t border-border-subtle bg-surface px-3 py-2.5">
        <span className="font-mono text-xs text-text">{token.name}</span>
        {token.deeper && (
          <span
            className="text-xs text-text-tertiary"
            title="These words failed 4.5:1 or sat on it, so they went a shade deeper to clear it (decision 5)"
          >
            Words deeper, not lighter
          </span>
        )}
      </div>
      {GROUNDS.map((g) => (
        <div
          key={g}
          data-ground={g}
          style={{ background: `var(--color-${g})` }}
          className="flex flex-col gap-2 border-t border-border-subtle px-3 py-2.5"
        >
          {token.mark && <Marks color={token.mark} theme={theme} />}
          {token.word && <Words color={token.word} theme={theme} />}
        </div>
      ))}
    </>
  )
}

/* ---- real pieces of the app ---- */

const ROW_TITLES = [
  'Sidebar refresh',
  'Rounds see blockers outside the round',
  SELECTED_TITLE,
  'Prepare reruns stale checks',
  'Changelog file per release',
  'Dark terminal palette',
  'First-run wizard',
]
const sidebarRows = ROW_TITLES.flatMap((t) => busyFeatures.filter((f) => f.title === t))
const selectedId = busyFeatures.find((f) => f.title === SELECTED_TITLE)?.id ?? null

function SidebarRows() {
  return (
    <div className="flex w-[264px] flex-col gap-1 rounded-lg border border-border-subtle bg-canvas p-2">
      {sidebarRows.map((f: FeatureListItem) => (
        <SidebarFeatureRow key={f.id} f={f} active={f.id === selectedId} onSelect={noop} actions={rowActions} />
      ))}
    </div>
  )
}

const NOTICES: ChatNotice[] = [
  {
    kind: 'preview',
    hue: 'planning',
    title: 'Preview ready',
    subtitle: 'The plan preview has three screens to look at',
    actionLabel: 'Open the preview',
    target: 'preview',
    count: 1,
    eventId: 1,
  },
  {
    kind: 'ticket-failed',
    hue: 'danger',
    title: 'Ticket 4 failed',
    subtitle: 'typecheck failed',
    actionLabel: 'Open the run',
    target: 'body',
    count: 2,
    eventId: 2,
  },
]

/** Each notice in its own deck, so both hues are readable at once (a deck shows only its newest card). */
function Notices() {
  return (
    <div className="flex flex-col gap-2">
      {NOTICES.map((n) => (
        <div key={n.kind} className="relative h-[132px] w-[392px] rounded-lg bg-surface">
          <NoticeDeck notices={[n]} onAct={noop} onDismiss={noop} />
        </div>
      ))}
    </div>
  )
}

const TONES: StatusTone[] = ['success', 'warning', 'danger', 'accent', 'live', 'neutral']

function StatusRow() {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface p-3">
      <div className="flex items-center gap-3">
        {TONES.map((t) => (
          <StatusDot key={t} tone={t} label={t} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {TONES.map((t) => (
          <StatusLabel key={t} tone={t}>
            {t}
          </StatusLabel>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusLabel tone="success" icon={<IconCheck />}>
          Succeeded
        </StatusLabel>
        <StatusLabel tone="warning" icon={<IconAlert />}>
          High
        </StatusLabel>
        <StatusLabel tone="danger" icon={<IconAlert />}>
          Failed
        </StatusLabel>
      </div>
    </div>
  )
}

/**
 * The walkthrough player's scrub track and markers, with WalkthroughPlayer's
 * own marker classes (it does not export them). Today the numbered marker is
 * filled with the hue; the retune fills it with the word peer so its white
 * number keeps 4.5:1 (decision 9).
 */
function WalkthroughMarkers({ palette }: { palette: Palette }) {
  const numbered = palette === 'today' ? 'bg-accent' : 'bg-accent-text'
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface p-3 text-icon">
      <div className="relative h-1 flex-1 rounded-full bg-surface-selected">
        {[20, 55].map((at, i) => (
          <span
            key={at}
            style={{ left: `${at}%` }}
            className={cx(
              'absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs leading-none text-on-primary',
              numbered,
            )}
          >
            {i + 2}
          </span>
        ))}
        <span
          style={{ left: '80%' }}
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
        />
      </div>
      <IconChevronRight />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-medium text-text-tertiary">{title}</h3>
      {children}
    </section>
  )
}

/* ---- the page ---- */

/**
 * One palette's column. "Today" repaints its subtree with today's light values
 * — in light only; in dark it sets nothing, so the two columns must match, the
 * check that dark did not change. "New" is the live theme.
 */
function Column({ palette, theme }: { palette: Palette; theme: ResolvedTheme }) {
  const style = palette === 'today' && theme === 'light' ? (TODAY_LIGHT as CSSProperties) : undefined
  return (
    <div style={style} className="flex shrink-0 flex-col gap-6">
      <div className="text-lg font-semibold text-text">{palette === 'today' ? 'Today' : 'New'}</div>
      <TokenGrid theme={theme} />
      <div className="flex flex-wrap items-start gap-6">
        <Section title="Sidebar rows (one selected, one failed)">
          <SidebarRows />
        </Section>
        <div className="flex flex-col gap-6">
          <Section title="Chat notice cards">
            <Notices />
          </Section>
          <Section title="Error banner">
            <div className="w-[392px] rounded-lg bg-surface p-3">
              <FailureNote
                message="Run failed: typecheck failed"
                path="packages/server/src/services/features.ts"
                hint="Fix the error on the integration branch, then burn again."
              />
            </div>
          </Section>
          <Section title="Status dots and labels">
            <StatusRow />
          </Section>
          <Section title="Walkthrough markers">
            <WalkthroughMarkers palette={palette} />
          </Section>
        </div>
      </div>
    </div>
  )
}

type View = 'both' | Palette

const VIEWS: { key: View; label: string }[] = [
  { key: 'both', label: 'Side by side' },
  { key: 'today', label: 'Today' },
  { key: 'new', label: 'New' },
]

function Page() {
  const theme = useTheme()
  const [view, setView] = useState<View>('both')
  const shown: Palette[] = view === 'both' ? ['today', 'new'] : [view]
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle px-3 text-xs text-text-tertiary">
        <span>Show</span>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={cx(
              'h-6 cursor-pointer rounded-md px-2',
              v.key === view ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary',
            )}
          >
            {v.label}
          </button>
        ))}
        <button
          type="button"
          onClick={theme.toggle}
          className="h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover/50 hover:text-text-secondary"
        >
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
        <span className="ml-auto">
          {theme.resolved === 'dark'
            ? 'Dark is unchanged: both columns must match'
            : `Words hold ${WORD_FLOOR}:1, marks ${MARK_FLOOR}:1`}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 gap-10 overflow-auto p-6">
        {shown.map((p) => (
          <Column key={p} palette={p} theme={theme.resolved} />
        ))}
      </div>
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
