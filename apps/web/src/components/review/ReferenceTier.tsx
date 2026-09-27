import type { ReactNode } from 'react'

/**
 * The page's fourth tier (simplify-the-pages decision 7): what the human reads
 * once and comes back to rarely, at lighter weight than the work above it. The
 * lap timeline leads under its quiet "History" label, then the read-once text
 * as plain closed rows, sharing one hairline at the foot.
 *
 * The same on review and shipped, so the reference half of the page never
 * reads differently from one state to the next.
 */
export function ReferenceTier({ history, children }: { history: ReactNode; children: ReactNode }) {
  return (
    <div data-tier="reference" className="flex flex-col gap-4">
      {history}
      <div className="flex flex-col [&>*:last-child]:border-b [&>*:last-child]:border-border-subtle">{children}</div>
    </div>
  )
}
