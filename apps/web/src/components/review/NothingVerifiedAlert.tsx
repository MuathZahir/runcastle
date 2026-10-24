import { Notice } from './Notice'
import type { UnverifiedLap } from '../../lib/feature-ui'

/**
 * "Nothing verified" — the page's top line when the latest review pass ran
 * and verified nothing (decision 5).
 *
 * This is the whole point of the feature: a pass that could not attach a
 * browser used to land as a clean bill of health, and the human planned the
 * next round off an empty defects list. So it arrives loudly — an alert band,
 * above the stage, before anything else on the page — and blocks nothing:
 * the findings are stored, and Merge is still one click away.
 *
 * The words are runcastle's own: the templated line the harvester composed into
 * the pass's digest, and the reason the pass declared. The agent's prose is in
 * the Full account, where a report that verified nothing belongs. It offers no
 * button: another review is the agent's to run, so the human asks in the chat
 * (tickets-and-review-are-tools-not-phases decision 12).
 */
export function NothingVerifiedAlert({ outcome }: { outcome: UnverifiedLap }) {
  return (
    <Notice tone="accent" title="Nothing verified">
      <p className="m-0">
        The review pass ran and produced no evidence, so nothing on this branch has been checked.
        Nothing is blocked — ask the agent for another review, or drive it yourself, before you ship.
      </p>
      {outcome.line && <p className="m-0 mt-1.5 break-words text-text">{outcome.line}</p>}
      {outcome.reason && (
        <p className="m-0 mt-1 font-mono text-xs break-words text-text-tertiary">{outcome.reason}</p>
      )}
    </Notice>
  )
}
