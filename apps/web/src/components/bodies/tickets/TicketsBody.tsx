import { useState } from 'react'
import { trpc } from '../../../trpc'
import type { QueryResult, SettingsView } from '../../../lib/api'
import { SANDBOX_MODE } from '../../../lib/env'
import { shortSha } from '../../../lib/format'
import { useLivePoll } from '../../../lib/live'
import { effectiveStepModel, rosterFromView } from '../../../lib/settings'
import { useToast } from '../../../lib/toast'
import { cx, DimLine, Skeleton, SkeletonBar } from '../../../ui'
import { DocPeek } from '../../DocPeek'
import { TicketLedger } from './TicketLedger'
import type { TicketPatch } from './TicketEditor'

export function TicketsBody({ featureId }: { featureId: string }) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: useLivePoll() })
  const [peek, setPeek] = useState<string | null>(null)
  const edit = trpc.ticket.edit.useMutation({
    onSuccess: () => { void utils.feature.get.invalidate({ id: featureId }) },
    onError: (error) => toast.push(error.message),
  })
  const cancel = trpc.ticket.cancel.useMutation({
    onSuccess: () => { void utils.feature.get.invalidate({ id: featureId }); toast.push('ticket cancelled', 'success') },
    onError: (error) => toast.push(error.message),
  })
  const projectId = full.data?.feature.projectId
  const settings: QueryResult<SettingsView> = trpc.settings.get.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId },
  )
  const roster = rosterFromView(settings.data)
  const defaultModel = effectiveStepModel(settings.data, 'implement') ?? '…'
  const data = full.data

  if (full.isLoading) return <TicketsSkeleton />
  if (!data) return <DimLine>Could not load tickets: {full.error?.message ?? 'unknown'}</DimLine>
  const { feature, tickets, docs } = data

  // The row awaits this so the editor stays open — and keeps the human's text —
  // when the save fails; the mutation's own handler raises the error toast.
  const save = async (ticketId: string, patch: TicketPatch) => {
    await edit.mutateAsync({ ticketId, ...patch })
    toast.push('ticket updated', 'success')
  }
  const setModel = (ticketId: string, model: string) => edit.mutate({ ticketId, model })
  // One edit per ticket, in sequence: the wire takes a single ticket at a time
  // and a burst of parallel writes would race the invalidation below.
  const bulkModel = async (model: string) => {
    const pending = pendingTicketsForLap(tickets, feature.lap)
    try {
      for (const ticket of pending) await utils.client.ticket.edit.mutate({ ticketId: ticket.id, model })
      await utils.feature.get.invalidate({ id: featureId })
      toast.push(`${pending.length} tickets set to ${model || 'the default model'}`, 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'could not update ticket models')
    }
  }
  const ledger = <TicketLedger tickets={tickets} currentLap={feature.lap} roster={roster} docs={docs} sandbox={SANDBOX_MODE} defaultModel={defaultModel} onDoc={setPeek} onEdit={save} onModel={setModel} onBulkModel={(model) => { void bulkModel(model) }} onCancel={(ticketId) => cancel.mutate({ ticketId })} onCopySha={(sha) => { void navigator.clipboard.writeText(sha); toast.push(`copied ${shortSha(sha)}`, 'info') }} />

  // `flex-1` because the workspace's two-pane wrapper lays its body out in a
  // row: a stack that only takes its content width leaves the ledger's titles,
  // dependency chips and model menus crowded into half the window — the squeeze
  // decision 6 chose a vertical stack to avoid.
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
    <section aria-label="Tickets" className="flex min-h-0 flex-col">
      <h2 className="m-0 mb-2 text-lg font-semibold text-text">Tickets</h2>
      {ledger}
    </section>
    {peek && <DocPeek featureId={featureId} relPath={peek} title={docs.find((doc) => doc.relPath === peek)?.title ?? peek} onClose={() => setPeek(null)} />}
  </div>
}

/** Title widths for the placeholder ticket rows. */
const SKELETON_TITLES = ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5'] as const

/**
 * The tickets while the feature's first read is in flight: the section heading
 * and the ledger's meta line, then ticket rows on `ListRow`'s metrics — a 40px
 * row of chevron, `#seq` and title, divided by `border-subtle`.
 */
export function TicketsSkeleton() {
  return (
    <Skeleton label="Loading tickets…" className="min-w-0 flex-1">
      <div className="mb-2 flex h-7 items-center">
        <SkeletonBar className="h-4 w-20" />
      </div>
      <div className="mb-2 flex min-h-7 items-center">
        <SkeletonBar className="h-2.5 w-40" />
      </div>
      <div>
        {SKELETON_TITLES.map((width, i) => (
          <div
            key={i}
            className="flex min-h-10 items-center gap-3 border-b border-border-subtle px-3 last:border-b-0"
            data-skeleton="ticket-row"
          >
            <SkeletonBar className="size-3" />
            <SkeletonBar className="h-2.5 w-5" />
            <SkeletonBar className={cx('h-3', width)} />
          </div>
        ))}
      </div>
    </Skeleton>
  )
}

export function pendingTicketsForLap<T extends { lap: number; status: string }>(tickets: readonly T[], lap: number): T[] {
  return tickets.filter((ticket) => ticket.lap === lap && ticket.status === 'pending')
}
