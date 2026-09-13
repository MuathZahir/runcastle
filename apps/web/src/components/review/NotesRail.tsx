import type { ComponentProps, CSSProperties } from 'react'
import { clampNotesRailWidth, useNotesRailWidth } from '../../lib/notes-rail-width'
import { RailResizeHandle } from '../RailResizeHandle'
import { OpenWork } from './OpenWork'

/**
 * The review page's notes rail (decision 2): the open work — the review agent's
 * defects and the human's notes — beside the stage, at all times.
 *
 * It used to be a band below the stage (decision 18 of
 * `flow-redesign-build-review-and-ship`), which put it below the fold: every
 * note written or triaged during a drive scrolled the stage out of view, the
 * exact failure decision 21(e) forbade for the walkthrough player. So the rail
 * is permanent — no collapse toggle and no breakpoints, since a sometimes-absent
 * rail re-creates the "where are my notes" problem the move is answering.
 *
 * This is the frame only: the width, the hairline and the drag. What is inside
 * it is {@link OpenWork}, unchanged in anatomy — the rows moved, they did not
 * change (decision 23).
 */
export function NotesRail(props: ComponentProps<typeof OpenWork>) {
  const { width, setWidth } = useNotesRailWidth()

  return (
    <aside
      className="relative flex min-h-0 w-(--notes-rail-w) flex-none flex-col border-l border-hairline bg-panel-2"
      // The token declares the default; a drag overrides it here, so the width
      // is one value read one way whether or not anybody has ever dragged.
      style={{ '--notes-rail-w': `${width}px` } as CSSProperties}
    >
      <RailResizeHandle
        width={width}
        side="right"
        label="Resize the notes rail"
        clamp={clampNotesRailWidth}
        onResize={setWidth}
      />
      <OpenWork {...props} />
    </aside>
  )
}
