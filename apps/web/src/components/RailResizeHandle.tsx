import { useEffect, useRef, useState } from 'react'

/**
 * A rail's drag handle (decision 10) — the features rail's, and the review
 * page's notes rail's, which is why it belongs to neither of them.
 *
 * It straddles the rail's inner edge so the cursor finds it a pixel or two
 * either side of the hairline, and the drag is measured as a delta from where it
 * started rather than from the pointer's absolute position, so it never jumps
 * when the grab lands off-centre. Mouse only. Text selection is suspended while
 * dragging — without it, sweeping across the rail selects everything on the way
 * past.
 *
 * The rail it belongs to must be `relative`: the handle positions itself against
 * that edge.
 */
export function RailResizeHandle({
  width,
  side,
  label,
  clamp,
  onResize,
}: {
  /** The rail's current width in px — the drag's starting point. */
  width: number
  /**
   * Which side of the workspace the rail is on. A rail on the left widens as
   * the drag moves right and carries its handle on its right edge; a rail on
   * the right is the mirror of that.
   */
  side: 'left' | 'right'
  /** What the separator is called, read out to whoever cannot see the hairline. */
  label: string
  /** The rail's own clamp, applied to every width the drag measures. */
  clamp: (px: number) => number
  onResize: (px: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  // The grab point and the width it started from; read by the move listener.
  const origin = useRef({ x: 0, width })

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const travelled = e.clientX - origin.current.x
      onResize(clamp(origin.current.width + (side === 'left' ? travelled : -travelled)))
    }
    const onUp = () => setDragging(false)
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.userSelect = previousUserSelect
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [clamp, dragging, onResize, side])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize"
      className={`absolute top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors duration-(--dur-1) ease-app hover:bg-border-strong ${
        side === 'left' ? '-right-[3px]' : '-left-[3px]'
      } ${dragging ? 'bg-border-strong' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault()
        origin.current = { x: e.clientX, width }
        setDragging(true)
      }}
    />
  )
}
