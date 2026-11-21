import { StatusDot } from '../../ui/status'

/** The mark a card or a row wears until the human has opened what it shows (designs-and-the-plan-get-their-own-place decision 11). */
export function NewMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-text">
      <StatusDot tone="accent" />
      New
    </span>
  )
}

/** The words an older card carries in place of New (decision 19). */
export function OlderMark() {
  return <span className="shrink-0 text-xs text-text-tertiary">Older version</span>
}
