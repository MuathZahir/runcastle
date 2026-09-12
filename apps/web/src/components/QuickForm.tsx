import { useState } from 'react'
import { duplicateTitleWarning, slugPreview } from '../lib/feature-ui'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import { trpc } from '../trpc'
import { FormOverlay } from './FormOverlay'
import { ParkDraftMode } from './quick/ParkDraftMode'

/**
 * The Draft door — the rail's second creation door, and the only one that is a
 * form. Its other half used to be a quick-change tab that turned typed prose
 * into a burn-ready feature; that work belongs to the project chat now, which
 * reaches the same server door with screenshots and the portfolio behind it.
 *
 * So this parks an idea and nothing else: no base branch, no branch cut, no
 * tickets. A title, an optional one-liner, and Notes that land as the draft's
 * brief.
 */
export function QuickForm({ projectId, onCancel, onCreated }: { projectId: string; onCancel: () => void; onCreated: (featureId: string) => void }) {
  const [title, setTitle] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [notes, setNotes] = useState('')
  const utils = trpc.useUtils()
  const toast = useToast()

  const featuresQ = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const duplicate = duplicateTitleWarning(title, featuresQ.data ?? [])
  const landed = async (featureId: string) => { await utils.feature.list.invalidate(); onCreated(featureId) }
  const create = trpc.feature.create.useMutation({ onSuccess: (feature) => void landed(feature.id), onError: (error) => toast.push(error.message) })
  const busy = create.isPending
  const ready = !!title.trim()
  const dirty = !!title.trim() || !!oneLiner.trim() || !!notes.trim()

  const submit = (draftBrief?: string) => {
    if (!ready || busy) return
    create.mutate({ projectId, title: title.trim(), oneLiner: oneLiner.trim(), draft: true, ...(draftBrief ? { brief: draftBrief } : {}) })
  }

  return (
    <FormOverlay dirty={dirty} onDismiss={onCancel}>
      {(dismiss) => <ParkDraftMode
        title={title} slug={slugPreview(title)} oneLiner={oneLiner} notes={notes} duplicate={duplicate} busy={busy} ready={ready}
        onTitleChange={setTitle} onOneLinerChange={setOneLiner} onNotesChange={setNotes}
        onSubmit={submit} onCancel={dismiss}
      />}
    </FormOverlay>
  )
}
