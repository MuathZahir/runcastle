import { StrictMode, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { cx } from '../src/ui'

/**
 * Fewer, darker greys (docs/features/fewer-darker-greys): the app's colours
 * before the feature beside the ones it shipped, over the app's own design
 * pages. Each screen is an existing page in a frame. The "after" frame is the
 * app as it is; the "before" frame gets the old tokens set on its root, so the
 * real components repaint in yesterday's colours.
 *
 * Views: Split (drag the line: left is before, right is after), Before, After,
 * and All four (both themes, before and after, scaled down to compare at a
 * glance). A dead end on purpose: the frames are the design pages, whose own
 * links do nothing.
 */

type Theme = 'dark' | 'light'
type Tokens = Record<string, string>

/** The tokens before this feature, as theme.css had them, per theme. */
const BEFORE: Record<Theme, Tokens> = {
  dark: {
    canvas: '#0a0c11',
    surface: '#10131a',
    'surface-raised': '#161a24',
    'surface-inset': '#0c0e14',
    border: '#222837',
    'border-strong': '#333a4d',
    'text-secondary': '#a2a8b9',
    'text-tertiary': '#8a91a5',
    icon: '#8990a4',
    'text-disabled': '#4b5163',
    'on-primary': '#0a0c11',
    'surface-hover': 'color-mix(in oklab, var(--color-text) 3.5%, transparent)',
    'fill-card': 'color-mix(in oklab, var(--color-text) 2.5%, transparent)',
  },
  light: {
    'text-secondary': '#596075',
    'text-tertiary': '#676e82',
    icon: '#7a8195',
    'surface-hover': 'color-mix(in oklab, var(--color-text) 4%, transparent)',
    'fill-card': 'color-mix(in oklab, var(--color-text) 3%, transparent)',
  },
}

interface Screen {
  key: string
  label: string
  src: string
  /** The design page's own sample bar, cut off the top of the frame. */
  cropTop: number
  /** What to do once the page is up: open the panel, open a menu. */
  after?: (doc: Document) => void
}

/** Wait for an element the page renders, then act on it. */
function when(doc: Document, find: (d: Document) => Element | null | undefined, act: (el: HTMLElement) => void) {
  let tries = 0
  const tick = () => {
    const el = find(doc)
    if (el) return act(el as HTMLElement)
    if (++tries < 40) setTimeout(tick, 100)
  }
  tick()
}

const byLabel = (part: string) => (d: Document) =>
  [...d.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label')!.toLowerCase().includes(part))
const byText = (part: string) => (d: Document) =>
  [...d.querySelectorAll('button')].find((b) => b.textContent?.includes(part))

/** The feature-panel page's own step picker floats over its sidebar: hide it. */
function hideStepPicker(doc: Document) {
  when(
    doc,
    (d) => [...d.querySelectorAll('span,div,p')].find((n) => n.textContent?.trim() === 'Step'),
    (el) => {
      let box: HTMLElement | null = el
      const win = doc.defaultView!
      while (box && !['fixed', 'absolute'].includes(win.getComputedStyle(box).position)) box = box.parentElement
      if (box) box.style.display = 'none'
    },
  )
}

/** Radix opens its menus on a mouse pointerdown, not a click. */
function press(el: HTMLElement) {
  const win = el.ownerDocument.defaultView!
  el.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
}

const SCREENS: Screen[] = [
  { key: 'sidebar', label: 'Sidebar + Orchestrator', src: '/preview/orchestrator.html', cropTop: 36 },
  { key: 'tools', label: 'Chat with tool calls', src: '/preview/chat.html?moment=working', cropTop: 40 },
  {
    key: 'panel',
    label: 'Feature page + panel',
    src: '/preview/feature-panel.html?step=tickets',
    cropTop: 0,
    after: hideStepPicker,
  },
  {
    key: 'dialog',
    label: 'A dialog',
    src: '/preview/feature-panel.html?step=tickets',
    cropTop: 0,
    after: (doc) => {
      hideStepPicker(doc)
      when(doc, byText('Merge & ship'), (b) => b.click())
    },
  },
  {
    key: 'menu',
    label: 'A menu open',
    src: '/preview/chat.html?moment=idle',
    cropTop: 40,
    after: (doc) => when(doc, byText('Sonnet 5.5'), press),
  },
]

type View = 'split' | 'before' | 'after' | 'grid'
const VIEWS: { key: View; label: string }[] = [
  { key: 'split', label: 'Split' },
  { key: 'before', label: 'Before' },
  { key: 'after', label: 'After' },
  { key: 'grid', label: 'All four' },
]

const params = new URLSearchParams(location.search)

/** One design page in a frame, pinned to a theme, in the old colours or as the app is now. */
function Frame({
  screen,
  theme,
  tokens,
  scale = 1,
  className,
  style,
}: {
  screen: Screen
  theme: Theme
  tokens: Tokens | null
  scale?: number
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(0)

  const tokenKey = JSON.stringify(tokens ?? {})
  // Pin the theme and lay the old colours on the frame's root. Inline custom
  // properties beat both theme blocks, so the real components repaint.
  useEffect(() => {
    const doc = ref.current?.contentDocument
    if (!loaded || !doc) return
    const root = doc.documentElement
    const pin = () => {
      if (root.dataset.theme !== theme) root.dataset.theme = theme
    }
    pin()
    const watch = new MutationObserver(pin)
    watch.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    for (const name of [...root.style]) if (name.startsWith('--color-')) root.style.removeProperty(name)
    for (const [k, v] of Object.entries(JSON.parse(tokenKey) as Tokens)) root.style.setProperty(`--color-${k}`, v)
    return () => watch.disconnect()
  }, [loaded, theme, tokenKey])

  return (
    <div className={cx('overflow-hidden', className)} style={style}>
      <iframe
        ref={ref}
        title={screen.label}
        src={screen.src}
        onLoad={() => {
          setLoaded((n) => n + 1)
          const doc = ref.current?.contentDocument
          if (doc && screen.after) screen.after(doc)
        }}
        className="block border-0"
        style={{
          width: `${100 / scale}%`,
          height: `calc(${100 / scale}% + ${screen.cropTop}px)`,
          marginTop: -screen.cropTop * scale,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      />
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { key: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cx(
            'h-6 cursor-pointer rounded-md px-2 text-xs',
            o.key === value ? 'card text-text' : 'text-text-tertiary hover:bg-surface-hover hover:text-text-secondary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Split({ screen, theme }: { screen: Screen; theme: Theme }) {
  const [at, setAt] = useState(() => Number(params.get('at') ?? 50))
  const box = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const move = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    setAt(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)))
  }
  return (
    <div ref={box} className="relative min-h-0 flex-1">
      <Frame screen={screen} theme={theme} tokens={BEFORE[theme]} className="absolute inset-0" />
      <Frame
        screen={screen}
        theme={theme}
        tokens={null}
        className="absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${at}%)` }}
      />
      {/* While dragging, a cover keeps the frames from eating the pointer. */}
      {dragging && <div className="absolute inset-0 z-10 cursor-ew-resize" />}
      <div
        role="separator"
        aria-label="Before and after"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
        }}
        onPointerMove={(e) => dragging && move(e)}
        onPointerUp={() => setDragging(false)}
        className="absolute inset-y-0 z-20 -ml-2 w-4 cursor-ew-resize"
        style={{ left: `${at}%` }}
      >
        <div className="mx-auto h-full w-px bg-accent" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-[white]">
          ⟷
        </div>
      </div>
      <span className="pointer-events-none absolute top-2 left-3 z-20 rounded-md bg-scrim px-2 py-0.5 text-[11px] text-[white]">Before</span>
      <span className="pointer-events-none absolute top-2 right-3 z-20 rounded-md bg-accent px-2 py-0.5 text-[11px] text-[white]">After</span>
    </div>
  )
}

/** Both themes, before and after, each frame laid out at desktop size and scaled to its cell. */
function Grid({ screen }: { screen: Screen }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.45)
  useEffect(() => {
    const el = box.current!
    const fit = () => setScale(Math.min((el.clientWidth / 2 - 12) / 1440, 1))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cells: { theme: Theme; tokens: Tokens | null; label: string }[] = [
    { theme: 'dark', tokens: BEFORE.dark, label: 'Dark · before' },
    { theme: 'dark', tokens: null, label: 'Dark · after' },
    { theme: 'light', tokens: BEFORE.light, label: 'Light · before' },
    { theme: 'light', tokens: null, label: 'Light · after' },
  ]
  return (
    <div ref={box} className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-auto p-2">
      {cells.map((c) => (
        <figure key={c.label} className="m-0 flex flex-col gap-1">
          <figcaption className="text-xs text-text-secondary">{c.label}</figcaption>
          <Frame
            screen={screen}
            theme={c.theme}
            tokens={c.tokens}
            scale={scale}
            className="rounded-md ring-1 ring-border"
            style={{ width: 1440 * scale, height: 900 * scale }}
          />
        </figure>
      ))}
    </div>
  )
}

function Page() {
  const [screenKey, setScreenKey] = useState(params.get('screen') ?? 'sidebar')
  const [theme, setTheme] = useState<Theme>(params.get('theme') === 'light' ? 'light' : 'dark')
  const [view, setView] = useState<View>((params.get('view') as View | null) ?? 'split')
  const screen = SCREENS.find((s) => s.key === screenKey) ?? SCREENS[0]!
  // Remount the frames when the screen or view changes, so each page starts clean.
  const stage = `${screen.key}:${view}`
  return (
    <div className="relative flex h-screen flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-4 border-b border-border px-3">
        <span className="text-xs font-medium text-text">Fewer, darker greys</span>
        <Segmented value={screen.key} options={SCREENS.map((s) => ({ key: s.key, label: s.label }))} onChange={setScreenKey} />
        <span className="ml-auto" />
        {view !== 'grid' && (
          <Segmented
            value={theme}
            options={[
              { key: 'dark', label: 'Dark' },
              { key: 'light', label: 'Light' },
            ]}
            onChange={setTheme}
          />
        )}
        <Segmented value={view} options={VIEWS} onChange={setView} />
      </div>
      <div key={stage} className="flex min-h-0 flex-1 flex-col">
        {view === 'split' && <Split screen={screen} theme={theme} />}
        {view === 'before' && <Frame screen={screen} theme={theme} tokens={BEFORE[theme]} className="min-h-0 flex-1" />}
        {view === 'after' && <Frame screen={screen} theme={theme} tokens={null} className="min-h-0 flex-1" />}
        {view === 'grid' && <Grid screen={screen} />}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
