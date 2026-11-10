import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useLayoutEffect, useMemo, useState } from 'react'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import type { ThreadEntry } from '../lib/chat-thread'
import type { EpicColor, EpicIconId } from '../lib/epic-look'
import { PopoverContent } from '../ui/popover'
import { EpicLookPicker } from './EpicLookPicker'

/**
 * "Colour and icon…" from an epic's menu (epics-that-look-alive decision 3):
 * the picker, held open beside the epic's row in the list (`data-epic`), each
 * pick saved at once through `thread.setLook`. An icon picked here is the
 * human's, which the orchestrator never changes again. Closes on Escape or a
 * click outside.
 */
export function EpicLookPopover({ chat, onClose }: { chat: ThreadEntry; onClose: () => void }) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const [color, setColor] = useState<EpicColor>(chat.color ?? 'blue')
  const [icon, setIcon] = useState<EpicIconId | null>(chat.icon ?? null)
  const save = trpc.thread.setLook.useMutation({
    // The server's event refreshes the lists; this only spares the wait.
    onSuccess: () => void utils.thread.list.invalidate(),
    onError: (e) => toast.push(e.message),
  })
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => document.querySelector(`[data-epic="${chat.id}"]`)?.getBoundingClientRect() ?? new DOMRect(),
      },
    }),
    [chat.id],
  )
  // The anchor is read once the menu that opened this has closed and the list has painted.
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => setReady(true), [])
  if (!ready) return null
  return (
    <PopoverPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <PopoverPrimitive.Anchor virtualRef={anchor} />
      <PopoverContent side="right" align="start" sideOffset={10} className="p-0" aria-label={`${chat.title}: colour and icon`}>
        <EpicLookPicker
          color={color}
          icon={icon}
          onColor={(c) => {
            setColor(c)
            save.mutate({ threadId: chat.id, color: c })
          }}
          onIcon={(i) => {
            setIcon(i)
            save.mutate({ threadId: chat.id, icon: i })
          }}
        />
      </PopoverContent>
    </PopoverPrimitive.Root>
  )
}
