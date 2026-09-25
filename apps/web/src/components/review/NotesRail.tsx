import { Aside } from '../../ui'
import { OpenWorkPane, openTally, usePaneScroller, type OpenWorkProps } from './OpenWork'

/**
 * The review's notes as the ONE aside (DESIGN.md: one right-hand aside, opened
 * on demand, never a permanent empty rail).
 *
 * The review body mounts it beside the evidence stage while the stage has the
 * window (expanded), which is when notes must stay beside the stage — reaching a
 * note never scrolls the stage away (decision 2). In the ordinary page flow the
 * same rows are a section of the body ({@link OpenWork}) instead, and the rail
 * is not mounted at all.
 *
 * A shell that wants the notes in its own aside slot mounts this with the same
 * props the body passes plus `onClose`; it is self-contained (its own scroller,
 * the composer pinned under the rows).
 */
export function NotesRail({
  onClose,
  className,
  ...props
}: OpenWorkProps & {
  /** Close the aside (in the expanded stage: collapse back to the page). */
  onClose: () => void
  className?: string
}) {
  const scroller = usePaneScroller()
  const tally = props.rows.length > 0 ? openTally(props.rows) : null

  return (
    <Aside
      label="Needs attention"
      title={
        <span className="flex items-baseline gap-2">
          Needs attention
          {tally && <span className="text-xs font-normal text-text-tertiary tabular-nums">{tally}</span>}
        </span>
      }
      onClose={onClose}
      className={className}
      bodyClassName="flex flex-col"
    >
      <OpenWorkPane {...props} scroller={scroller} />
    </Aside>
  )
}
