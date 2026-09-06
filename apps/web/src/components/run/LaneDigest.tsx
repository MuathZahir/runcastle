import { Markdown } from '../Markdown'

/**
 * What one burner said it did, inside its own lane's expansion.
 *
 * The digest is the only account of a lane that outlives the burn — transcripts
 * are held in server memory for the current run only, so on a run record it is
 * all there is. Collapsed, because the lane's state and its verdict are what the
 * human reads first and this is the prose behind them (decision #6).
 */
export function LaneDigest({ digest }: { digest?: string }) {
  if (!digest?.trim()) return null
  return (
    <details className="border-b border-hairline-soft">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold tracking-[0.07em] text-text-3 uppercase [&::-webkit-details-marker]:hidden">
        What this ticket produced
      </summary>
      <div className="border-t border-hairline-soft px-3 py-2">
        <Markdown source={digest} />
      </div>
    </details>
  )
}
