import { useState } from 'react'
import type { FeatureSize } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { Button } from '../ui'

/**
 * The new-feature form (app-redesign) — owns the whole workspace while open.
 * Name it, pick a size, and starting it creates the feature AND opens a grill
 * session so the ideation body is live the moment you land on it. `full` skips
 * nothing; `collapsed` (Small) skips the spec phase.
 */
export function NewFeatureForm({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: string
  onCancel: () => void
  onCreated: (featureId: string) => void
}) {
  const [title, setTitle] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [size, setSize] = useState<FeatureSize>('full')
  const [mapped, setMapped] = useState(false)
  const utils = trpc.useUtils()
  const toast = useToast()

  const launch = trpc.feature.launchSession.useMutation()
  const create = trpc.feature.create.useMutation({
    onSuccess: async (feature) => {
      await utils.feature.list.invalidate()
      // Best-effort: open a grill session so the ideation body lands live.
      launch.mutate(
        { featureId: feature.id, kind: 'ideation' },
        { onSettled: () => void utils.feature.get.invalidate({ id: feature.id }) },
      )
      onCreated(feature.id)
    },
    onError: (e) => toast.push(e.message),
  })

  const slug = slugify(title)
  const busy = create.isPending || launch.isPending
  const submit = () => {
    const t = title.trim()
    if (t) create.mutate({ projectId, title: t, oneLiner: oneLiner.trim(), size, mapped })
  }

  return (
    <div className="nf-overlay">
      <div className="nf-card">
        <div className="nf-kick">NEW FEATURE</div>
        <div className="nf-h">What are we building?</div>
        <div className="nf-sub">
          Name it and pick a size — runcastle opens a grill session so you and Claude shape the idea
          before any code is written.
        </div>

        <input
          className="nf-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Slack notifications on failed runs"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />

        <input
          className="nf-input nf-oneliner"
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          placeholder="one-liner (optional) — what & why in a sentence"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />

        <div className="nf-controls">
          <div className="size-toggle">
            <button className={size === 'full' ? 'is-on' : ''} onClick={() => setSize('full')}>
              Full
            </button>
            <button
              className={size === 'collapsed' ? 'is-on' : ''}
              onClick={() => setSize('collapsed')}
            >
              Small
            </button>
          </div>
          <span className="size-hint">
            {size === 'collapsed'
              ? 'Small skips the spec phase.'
              : 'Full runs the whole six-phase pipeline.'}
          </span>
        </div>

        <label className="nf-mapped">
          <input
            type="checkbox"
            checked={mapped}
            onChange={(e) => setMapped(e.target.checked)}
          />
          <span className="nf-mapped-text">
            <span className="nf-mapped-label">Start mapped</span>
            <span className="size-hint">
              Chart the idea as a waypoint map when it's too big for one grill — orthogonal to size.
            </span>
          </span>
        </label>

        <div className="nf-branch">branch · feat/{slug || '…'}</div>

        <div className="nf-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="solid" onClick={submit} disabled={!title.trim() || busy}>
            {busy ? 'Starting…' : 'Start grill session'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
