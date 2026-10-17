import type { ReactNode } from 'react'
import type { ReviewFinding, TicketKind } from '@runcastle/core'
import { Disclosure, SectionLabel } from '../../ui'
import { IconDoc } from '../../icons'
import { headline, type RoundAccount } from '../../lib/feature-ui'
import { Markdown } from '../Markdown'

/** A ticket as the accounts band reads it — its own words and whose they are. */
export interface AccountTicket {
  seq: number
  title: string
  kind?: TicketKind
  digest?: string
}

/**
 * ONE collapsed disclosure at the bottom of the review page (decision 8).
 *
 * Everything written in words about the latest round is behind it: its write-up
 * in full — the page lifts its first line out and renders that alone above as
 * the round account, and this is where the account it opens is read — every
 * burner's own account of its ticket, the work already dealt with, and the
 * observations. It used to OPEN the page: a wall of ~200-word
 * digests above the evidence, which is the "far too much text… confusing rather
 * than informative" the human named. The text is not deleted, it is demoted;
 * state and the open work lead, prose follows.
 *
 * Observations land here and NOWHERE else — not even as a count on arrival
 * (decision 2). With the defect boundary redrawn at the source (decision 1),
 * what is left in that bucket is inert by construction, so a line of it on
 * arrival costs the human a read and tells them nothing.
 *
 * Renders nothing at all when nobody wrote anything and nothing has been dealt
 * with — a disclosure that opens on emptiness is worse than no disclosure.
 */
export function FullAccounts({
  account,
  tickets,
  roundOf,
  observations = [],
  carried,
}: {
  /** What the latest round landed, in prose (decisions #8), or null when nobody said. */
  account: RoundAccount | null
  tickets: readonly AccountTicket[]
  /** The round that ran a ticket, by seq — said beside its digest when known. */
  roundOf?: ReadonlyMap<number, number>

  /** What the review saw that no fix ticket could act on (decision 2). */
  observations?: readonly ReviewFinding[]
  /** The rows already carried, quick-fixed or handled, or null when there are none. */
  carried?: ReactNode
}) {
  // A review pass's digest is not listed (decision 6c): the round write-up above
  // is that account.
  const digests = tickets
    .filter((ticket) => ticket.kind !== 'review' && (ticket.digest ?? '').trim().length > 0)
    .sort((a, b) => a.seq - b.seq)
  const hasDigest = !!account || digests.length > 0
  if (!hasDigest && !carried && observations.length === 0) return null

  const summary = [
    hasDigest ? 'digest' : null,
    carried ? 'carried' : null,
    observations.length > 0
      ? `${observations.length} observation${observations.length === 1 ? '' : 's'}`
      : null,
  ].filter((part): part is string => part !== null)

  return (
    <div id="full-accounts">
      <Disclosure title="Full account" icon={<IconDoc />} aside={summary.join(' · ')}>
        <div className="flex flex-col gap-6 pt-1">
          {account && <RoundAccountBlock account={account} />}

          {digests.length > 0 && (
            <section>
              <SectionLabel>Ticket digests</SectionLabel>
              <div className="mt-2 flex flex-col gap-5">
                {digests.map((ticket) => (
                  <div key={ticket.seq}>
                    <div className="text-sm font-medium text-text">
                      #{ticket.seq} {ticket.title}
                      {roundOf?.has(ticket.seq) && (
                        <span className="ml-2 font-normal text-text-tertiary">round {roundOf.get(ticket.seq)}</span>
                      )}
                    </div>
                    <Markdown source={ticket.digest!.trim()} className="mt-2" />
                  </div>
                ))}
              </div>
            </section>
          )}

          {carried && (
            <section>
              <SectionLabel>Carried, quick-fixed and handled</SectionLabel>
              <div className="mt-2">{carried}</div>
            </section>
          )}

          {observations.length > 0 && (
            <section>
              <SectionLabel count={observations.length}>Observations</SectionLabel>
              <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {observations.map((finding) => (
                  <li key={finding.id} className="flex flex-col gap-0.5">
                    <span className="text-sm text-text">{finding.title}</span>
                    <Observation detail={finding.detail} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Disclosure>
    </div>
  )
}

/** What an observation says: its first line, and the rest only if there is one. */
function Observation({ detail }: { detail: string }) {
  const { head, rest } = headline(detail)
  if (!rest) return <span className="text-sm text-text-tertiary">{head}</span>
  return (
    <Disclosure bare title={<span className="font-normal text-text-tertiary">{head}</span>}>
      <p className="m-0 text-sm text-pretty text-text-secondary">{rest}</p>
    </Disclosure>
  )
}

/**
 * What the latest round landed, in prose (decisions #8).
 *
 * The review agent's own digest is the summary: it ran last, held the spec plus
 * every implementation digest, and actually saw the result working. The workers'
 * per-ticket digests are the fallback, and they are LABELLED as the fallback,
 * because several agents each saying what they did is a different (and weaker)
 * thing than one account of the round.
 */
function RoundAccountBlock({ account }: { account: RoundAccount }) {
  return (
    <section>
      <SectionLabel>What the latest round landed</SectionLabel>
      {account.source === 'review' ? (
        <Markdown source={account.prose} className="mt-2" />
      ) : (
        <>
          <div className="mt-2 text-sm text-text-tertiary">
            No review summary this round — below is each worker’s own account of the ticket it ran.
          </div>
          <div className="mt-3 flex flex-col gap-4">
            {account.entries.map((entry) => (
              <div key={entry.seq}>
                <div className="text-sm font-medium text-text">
                  #{entry.seq} {entry.title}
                </div>
                <Markdown source={entry.digest} className="mt-2" />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
