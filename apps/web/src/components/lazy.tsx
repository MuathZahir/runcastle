import { lazy, Suspense, type ComponentProps } from 'react'
import { cx } from '../ui/floating'
import type { CommandPalette as CommandPaletteImpl } from './CommandPalette'
import type { DesignTab as DesignTabImpl } from './design/DesignTab'
import type { PhoneDesignView as PhoneDesignViewImpl } from './phone/PhoneDesignView'
import type { QrCode as QrCodeImpl } from './settings/QrCode'
import type { TerminalView as TerminalViewImpl } from './TerminalView'

/**
 * The rarely used, heavy parts of the app, loaded the first time one opens
 * (a-faster-web-app decision 9): the terminal (xterm and its stylesheet), the
 * design view, the command palette and the phone link's QR code. Each is its
 * own chunk, so a refresh downloads and parses none of them. Until its chunk
 * arrives, each shows a plain "Loading…" in the place it will fill.
 *
 * Import these, never the modules behind them: one static import anywhere pulls
 * the module back into the main chunk. Only types may be imported directly.
 */

/** The placeholder a lazy part shows while its code loads. */
export function LazyLoading({ className }: { className?: string }) {
  return (
    <div role="status" className={cx('flex items-center justify-center text-sm text-text-tertiary', className)}>
      Loading…
    </div>
  )
}

const TerminalViewLazy = lazy(() => import('./TerminalView').then((m) => ({ default: m.TerminalView })))
const DesignTabLazy = lazy(() => import('./design/DesignTab').then((m) => ({ default: m.DesignTab })))
const PhoneDesignViewLazy = lazy(() => import('./phone/PhoneDesignView').then((m) => ({ default: m.PhoneDesignView })))
const CommandPaletteLazy = lazy(() => import('./CommandPalette').then((m) => ({ default: m.CommandPalette })))
const QrCodeLazy = lazy(() => import('./settings/QrCode').then((m) => ({ default: m.QrCode })))

/** The embedded terminal. Fills its box, as the terminal itself does. */
export function TerminalView(props: ComponentProps<typeof TerminalViewImpl>) {
  return (
    <Suspense fallback={<LazyLoading className="h-full w-full" />}>
      <TerminalViewLazy {...props} />
    </Suspense>
  )
}

/** The feature's Design panel: its list and its live design view. */
export function DesignTab(props: ComponentProps<typeof DesignTabImpl>) {
  return (
    <Suspense fallback={<LazyLoading className="h-full min-h-0 flex-1" />}>
      <DesignTabLazy {...props} />
    </Suspense>
  )
}

/** The design view on a phone, a full screen of its own. */
export function PhoneDesignView(props: ComponentProps<typeof PhoneDesignViewImpl>) {
  return (
    <Suspense fallback={<LazyLoading className="h-full min-h-0 flex-1" />}>
      <PhoneDesignViewLazy {...props} />
    </Suspense>
  )
}

/**
 * The command palette. Mounted only while open (the caller's job), so its code
 * loads the first time someone opens it; until then a panel where it opens.
 */
export function CommandPalette(props: ComponentProps<typeof CommandPaletteImpl>) {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[300] flex items-start justify-center bg-scrim px-4 pt-[12vh] pb-4">
          <LazyLoading className="h-13 w-full max-w-[560px] rounded-lg bg-surface-raised shadow-dialog" />
        </div>
      }
    >
      <CommandPaletteLazy {...props} />
    </Suspense>
  )
}

/** The phone link's QR code, in the 180px square the code fills. */
export function QrCode(props: ComponentProps<typeof QrCodeImpl>) {
  return (
    <Suspense fallback={<LazyLoading className="size-[180px] shrink-0 rounded-md bg-surface-inset" />}>
      <QrCodeLazy {...props} />
    </Suspense>
  )
}
