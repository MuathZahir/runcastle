import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { createContext, useContext } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { cx } from './floating'

/** Whether an app-level `TooltipProvider` is above this tooltip. */
const Provided = createContext(false)

/**
 * A small label that appears after a 400ms hover or on keyboard focus — the
 * name of every `IconButton`, and anything else whose meaning a glyph carries
 * alone (DESIGN.md: chrome actions are icon buttons *with a tooltip label*).
 *
 * `TooltipProvider` is mounted once, in `main.tsx`, so every tooltip in the
 * app shares one delay and a moved pointer skips the delay between neighbours.
 * A tooltip is a label, never content: nothing interactive goes inside.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={300}>
      <Provided.Provider value>{children}</Provided.Provider>
    </TooltipPrimitive.Provider>
  )
}

/**
 * Wrap one focusable element (it is the trigger, via `asChild`) and name it.
 *
 * - `label` — the words shown. Keep them to a verb phrase: "Open settings".
 * - `kbd` — an optional shortcut hint shown after the label.
 * - `side` — which side of the trigger it opens on (default `top`).
 * - `disabled` — render the child alone, no tooltip.
 *
 * The trigger's accessible name is its own (`IconButton` sets `aria-label`
 * from the same string); Radix adds `aria-describedby` while it is open.
 */
export function Tooltip({
  label,
  kbd,
  side = 'top',
  align = 'center',
  disabled = false,
  children,
}: {
  label: ReactNode
  kbd?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  disabled?: boolean
  children: ReactElement
}) {
  const provided = useContext(Provided)
  if (disabled || label === undefined || label === null || label === '') return children
  const tip = (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cx(
            'z-[400] flex max-w-72 items-center gap-2 rounded-md bg-surface-raised px-2 py-1',
            'text-xs text-text shadow-popover select-none animate-pop-in',
          )}
        >
          {label}
          {kbd && <span className="font-sans text-xs text-text-tertiary">{kbd}</span>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
  // Outside the app's provider (a component test, an island) a tooltip brings
  // its own, rather than throwing the way a bare Radix Root does.
  return provided ? tip : <TooltipProvider>{tip}</TooltipProvider>
}
