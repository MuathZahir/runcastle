import { Disclosure } from '../../ui'
import { IconDoc } from '../../icons'
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
    <Disclosure bare title="What this ticket produced" icon={<IconDoc />}>
      <Markdown source={digest} />
    </Disclosure>
  )
}
