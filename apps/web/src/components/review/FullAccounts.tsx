import type { TicketKind } from '@runcastle/core'
import { SectionTitle } from '../../ui'
import type { LapAccount } from '../../lib/feature-ui'
import { Markdown } from '../Markdown'

/** A ticket as the accounts band reads it — its own words and whose they are. */
export interface AccountTicket {
  seq: number
  title: string
  kind?: TicketKind
  lap: number
  passKind?: 'review' | 'verification'
  digest?: string
}

/**
 * The prose band, collapsed (decision 18d).
 *
 * Everything an agent wrote about this feature in words — the review passes'
 * digests, every burner's own account of its ticket, and the lap summary derived
 * from them — lives behind one disclosure at the bottom of the page. It used to
 * OPEN the page: a wall of ~200-word digests above the evidence, which is the
 * "far too much text… confusing rather than informative" the human named. The
 * text is not deleted, it is demoted; evidence and state lead, prose follows.
 *
 * Renders nothing at all when no agent wrote anything — a disclosure that opens
 * on emptiness is worse than no disclosure.
 */
export function FullAccounts({
  account,
  tickets,
}: {
  /** What this lap landed, in prose (decisions #8), or null when nobody said. */
  account: LapAccount | null
  tickets: readonly AccountTicket[]
}) {
  const digests = tickets
    .filter((ticket) => (ticket.digest ?? '').trim().length > 0)
    .sort((a, b) => a.seq - b.seq)
  if (!account && digests.length === 0) return null

  return (
    <details id="full-accounts" className="rounded-lg border border-hairline bg-panel">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm text-text-2">
        Full accounts — the review passes’ digests and every burner’s own account
      </summary>
      <div className="flex flex-col gap-6 border-t border-hairline-soft px-4 py-4">
        {account && <LapAccountBlock account={account} />}

        {digests.length > 0 && (
          <section>
            <SectionTitle>Ticket digests</SectionTitle>
            <div className="mt-3 flex flex-col gap-4">
              {digests.map((ticket) => (
                <div key={ticket.seq} className="border-t border-hairline-soft pt-4 first:border-t-0 first:pt-0">
                  <div className="font-mono text-xs text-text-2">
                    #{ticket.seq} {ticket.title} · lap {ticket.lap}
                    {ticket.kind === 'review'
                      ? ticket.passKind === 'verification'
                        ? ' · verification pass'
                        : ' · review pass'
                      : ''}
                  </div>
                  <Markdown source={ticket.digest!.trim()} className="mt-2" />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </details>
  )
}

/**
 * What this lap landed, in prose (decisions #8).
 *
 * The review agent's own digest is the summary: it ran last, held the spec plus
 * every implementation digest, and actually saw the result working. The burners'
 * per-ticket digests are the fallback, and they are LABELLED as the fallback,
 * because several agents each saying what they did is a different (and weaker)
 * thing than one account of the lap.
 */
function LapAccountBlock({ account }: { account: LapAccount }) {
  return (
    <section>
      <SectionTitle>What landed this lap</SectionTitle>
      {account.source === 'review' ? (
        <Markdown source={account.prose} className="mt-3" />
      ) : (
        <>
          <div className="mt-3 text-sm text-text-3">
            No review summary this lap — below is each burner’s own account of the ticket it ran.
          </div>
          <div className="mt-3 flex flex-col gap-4">
            {account.entries.map((entry) => (
              <div key={entry.seq}>
                <div className="font-mono text-xs text-text-2">
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
