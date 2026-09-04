import { useEffect, useRef, useState } from 'react'
import { defaultBaseBranch, duplicateTitleWarning, slugPreview } from '../lib/feature-ui'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import { trpc } from '../trpc'
import { FormOverlay } from './FormOverlay'
import { ParkDraftMode } from './quick/ParkDraftMode'
import { QuickChangeMode } from './quick/QuickChangeMode'

type QuickMode = 'change' | 'draft'

export function QuickForm({ projectId, onCancel, onCreated }: { projectId: string; onCancel: () => void; onCreated: (featureId: string) => void }) {
  const [mode, setMode] = useState<QuickMode>('change')
  const [title, setTitle] = useState('')
  const [tickets, setTickets] = useState([''])
  const [oneLiner, setOneLiner] = useState('')
  const [notes, setNotes] = useState('')
  const [basePick, setBasePick] = useState('')
  const rowRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const [focusRow, setFocusRow] = useState<number | null>(null)
  const utils = trpc.useUtils()
  const toast = useToast()

  useEffect(() => {
    if (focusRow === null) return
    rowRefs.current[focusRow]?.focus()
    setFocusRow(null)
  }, [focusRow])

  const branchesQ = trpc.project.branches.useQuery({ projectId })
  const base = basePick || (branchesQ.data ? defaultBaseBranch(branchesQ.data) : '')
  const featuresQ = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const duplicate = duplicateTitleWarning(title, featuresQ.data ?? [])
  const landed = async (featureId: string) => { await utils.feature.list.invalidate(); onCreated(featureId) }
  const quickChange = trpc.feature.quickChange.useMutation({ onSuccess: (feature) => void landed(feature.id), onError: (error) => toast.push(error.message) })
  const create = trpc.feature.create.useMutation({ onSuccess: (feature) => void landed(feature.id), onError: (error) => toast.push(error.message) })
  const written = tickets.map((ticket) => ticket.trim()).filter(Boolean)
  const busy = quickChange.isPending || create.isPending
  const ready = mode === 'change' ? !!title.trim() && written.length > 0 && base !== '' : !!title.trim()
  const dirty = !!title.trim() || !!oneLiner.trim() || !!notes.trim() || written.length > 0

  const submit = (draftBrief?: string) => {
    if (!ready || busy) return
    if (mode === 'change') {
      quickChange.mutate({ projectId, title: title.trim(), tickets: written, baseBranch: base })
      return
    }
    create.mutate({ projectId, title: title.trim(), oneLiner: oneLiner.trim(), draft: true, ...(draftBrief ? { brief: draftBrief } : {}) })
  }
  const addTicket = (after: number) => {
    setTickets((rows) => [...rows.slice(0, after + 1), '', ...rows.slice(after + 1)])
    setFocusRow(after + 1)
  }
  const removeTicket = (index: number) => {
    setTickets((rows) => rows.length === 1 ? [''] : rows.filter((_, row) => row !== index))
    setFocusRow(Math.max(0, index - 1))
  }

  return (
    <FormOverlay dirty={dirty} onDismiss={onCancel}>
      {(dismiss) => <>
        <div className="flex border-b border-hairline-soft" role="tablist" aria-label="Quick door mode">
          {(['change', 'draft'] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={mode === tab} className={`h-(--control-h) border-b-2 px-3 text-sm ${mode === tab ? 'border-accent text-text' : 'border-transparent text-text-3 hover:text-text-2'}`} onClick={() => setMode(tab)}>
            {tab === 'change' ? 'Quick change' : 'Park a draft'}
          </button>)}
        </div>
        {mode === 'change' ? <QuickChangeMode
          title={title} duplicate={duplicate} tickets={tickets} writtenCount={written.length}
          slug={slugPreview(title)} base={base} branches={branchesQ.data?.branches}
          detectedBranch={branchesQ.data?.detected} busy={busy} ready={ready} rowRefs={rowRefs}
          onTitleChange={setTitle}
          onTicketChange={(index, value) => setTickets((rows) => rows.map((row, position) => position === index ? value : row))}
          onAddTicket={addTicket} onRemoveTicket={removeTicket} onBasePick={setBasePick}
          onSubmit={() => submit()} onCancel={dismiss}
        /> : <ParkDraftMode
          title={title} slug={slugPreview(title)} oneLiner={oneLiner} notes={notes} duplicate={duplicate} busy={busy} ready={ready}
          onTitleChange={setTitle} onOneLinerChange={setOneLiner} onNotesChange={setNotes}
          onSubmit={submit} onCancel={dismiss}
        />}
      </>}
    </FormOverlay>
  )
}
