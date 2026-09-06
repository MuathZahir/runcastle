import { useEffect, useState } from 'react'
import { trpc } from '../../../trpc'
import type { QueryResult, SettingsView } from '../../../lib/api'
import { SANDBOX_MODE } from '../../../lib/env'
import { shortSha } from '../../../lib/format'
import { useLivePoll } from '../../../lib/live'
import { effectiveStepModel, rosterFromView } from '../../../lib/settings'
import { sessionActive } from '../../../lib/feature-ui'
import { useToast } from '../../../lib/toast'
import { Button, DimLine } from '../../../ui'
import { DocPeek } from '../../DocPeek'
import { EndSessionButton } from '../../EndSessionButton'
import { SessionPanel } from '../../SessionPanel'
import { SessionStrip } from '../../session/SessionStrip'
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
  // The strip's open/collapsed choice decides how the body's height is shared
  // (decision 6), so the body owns it rather than the panel — which means
  // reading it here, above the loading guards where every hook has to live.
  const data = full.data
  const sessions = data?.sessions ?? []
  const live = [...sessions].reverse().find(sessionActive)
  const lapTickets = data ? data.tickets.filter((ticket) => ticket.lap === data.feature.lap) : []
  const terminal = useTerminalStrip(live?.id, lapTickets.length)

  if (full.isLoading) return <DimLine>loading tickets…</DimLine>
  if (!data) return <DimLine>could not load tickets: {full.error?.message ?? 'unknown'}</DimLine>
  const { feature, tickets, docs } = data
  const ended = [...sessions].reverse().find((session) => session.status === 'ended')

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
    {live && <TicketsTerminal featureId={featureId} live={live} ticketCount={lapTickets.length} open={terminal.open} onToggle={terminal.toggle} />}
    {!live && ended && <SessionStrip session={ended} />}
    {/* Collapsed, the ledger owns the body and scrolls inside itself; with the
        terminal open it keeps its natural height below a full-height panel and
        the body scrolls instead — neither may shrink to share the space. */}
    <div className={`flex min-h-0 flex-col${terminal.open ? ' shrink-0' : ''}`}>{ledger}</div>
    {peek && <DocPeek featureId={featureId} relPath={peek} title={docs.find((doc) => doc.relPath === peek)?.title ?? peek} onClose={() => setPeek(null)} />}
  </div>
}

export function pendingTicketsForLap<T extends { lap: number; status: string }>(tickets: readonly T[], lap: number): T[] {
  return tickets.filter((ticket) => ticket.lap === lap && ticket.status === 'pending')
}

/**
 * Whether the tickets terminal is open (decision 6). While the session is still
 * emitting, the terminal IS the work and holds the full body height; once
 * tickets exist the ledger is the work and the terminal folds to one line, one
 * click away. The choice is remembered per session, so a human who opened the
 * terminal keeps it open as further tickets land.
 */
function useTerminalStrip(sessionId: string | undefined, ticketCount: number) {
  const key = `runcastle.tickets.term:${sessionId ?? ''}`
  const [open, setOpen] = useState(ticketCount === 0)
  // The session arrives a render after this body mounts, so the stored choice is
  // read here rather than in the initializer. Absent one, the first ticket of a
  // session folds the panel — but only until the human has said otherwise, which
  // `toggle` writes.
  useEffect(() => {
    let stored: string | null = null
    try { stored = sessionStorage.getItem(key) } catch { /* storage may be unavailable */ }
    setOpen(stored === null ? ticketCount === 0 : stored === 'open')
  }, [key, ticketCount])
  const toggle = (value: boolean) => {
    setOpen(value)
    try { sessionStorage.setItem(key, value ? 'open' : 'closed') } catch { /* storage may be unavailable */ }
  }
  return { open, toggle }
}

/**
 * The session as a strip above the ledger, open or collapsed to its one line.
 * Open, the panel takes the whole body height and the ledger scrolls in beneath
 * it, so the wrapper is sized to the body and refuses to shrink; the panel's own
 * `flex-1` then fills it.
 */
function TicketsTerminal({ featureId, live, ticketCount, open, onToggle }: { featureId: string; live: Parameters<typeof SessionStrip>[0]['session']; ticketCount: number; open: boolean; onToggle: (value: boolean) => void }) {
  if (open) return <div className="flex h-full shrink-0 flex-col"><SessionPanel featureId={featureId} sessions={[live]} right={<Button className="h-7 text-xs" onClick={() => onToggle(false)}>Hide terminal</Button>} /></div>
  return <div className="flex-none rounded-lg border border-hairline bg-panel-2"><SessionStrip session={live} right={<><span className="font-mono text-xs text-text-3">· {ticketCount} tickets emitted</span><Button className="h-7 text-xs" onClick={() => onToggle(true)}>Show terminal ▸</Button><EndSessionButton featureId={featureId} sessionId={live.id} /></>} /></div>
}
