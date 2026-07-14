import { useState } from 'react'
import type { FeatureSize } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { needsMe, phaseGlyph, sortForSidebar } from '../lib/feature-ui'
import type { FeatureListItem } from '../lib/api'
import { DimLine } from '../ui'

/**
 * Features sidebar (UI-SPEC §2): one 28px row per feature — status glyph + slug
 * + right-aligned needs-me dot / burning spinner. Sorted needs-me → active →
 * shipped. Bottom: `+ New feature` ghost row expanding to an inline form.
 */
export function Sidebar({
  activeFeatureId,
  onSelect,
}: {
  activeFeatureId: string | null
  onSelect: (featureId: string) => void
}) {
  const list = trpc.feature.list.useQuery(undefined, { refetchInterval: 1500 })
  const features = list.data ? sortForSidebar(list.data) : []

  return (
    <aside className="sidebar">
      <div className="pane-title">Features</div>
      <div className="sidebar-list">
        {list.isLoading && <DimLine>loading features…</DimLine>}
        {list.data && features.length === 0 && (
          <DimLine>no features yet — create one below</DimLine>
        )}
        {features.map((f) => (
          <FeatureRow
            key={f.id}
            feature={f}
            active={f.id === activeFeatureId}
            onSelect={() => onSelect(f.id)}
          />
        ))}
      </div>
      <NewFeatureRow onCreated={onSelect} />
    </aside>
  )
}

function FeatureRow({
  feature,
  active,
  onSelect,
}: {
  feature: FeatureListItem
  active: boolean
  onSelect: () => void
}) {
  const nm = needsMe(feature)
  const shipped = feature.status === 'shipped'
  return (
    <button
      className={`feature-row${active ? ' is-active' : ''}${shipped ? ' is-shipped' : ''}`}
      onClick={onSelect}
      title={feature.title}
    >
      <span className={`feature-glyph phase-fg-${feature.phase}`}>
        {phaseGlyph(feature.phase)}
      </span>
      <span className="feature-slug mono">{feature.slug}</span>
      <span className="feature-flag">
        {feature.activeRun ? (
          <span className="spinner" title="burning" />
        ) : nm ? (
          <span className={`needs-dot needs-${nm.kind}`} title={nm.label} />
        ) : null}
      </span>
    </button>
  )
}

function NewFeatureRow({ onCreated }: { onCreated: (featureId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [size, setSize] = useState<FeatureSize>('full')
  const toast = useToast()
  const utils = trpc.useUtils()

  const create = trpc.feature.create.useMutation({
    onSuccess: (feature) => {
      utils.feature.list.invalidate()
      setTitle('')
      setOneLiner('')
      setSize('full')
      setOpen(false)
      onCreated(feature.id)
    },
    onError: (e) => toast.push(e.message),
  })

  if (!open) {
    return (
      <button className="new-feature-row" onClick={() => setOpen(true)}>
        + New feature
      </button>
    )
  }

  const submit = () => {
    if (!title.trim()) {
      toast.push('title is required')
      return
    }
    create.mutate({ title: title.trim(), oneLiner: oneLiner.trim(), size })
  }

  return (
    <form
      className="new-feature-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        className="nf-input"
        placeholder="title"
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="nf-input"
        placeholder="one-liner"
        value={oneLiner}
        onChange={(e) => setOneLiner(e.target.value)}
      />
      <div className="nf-row">
        <div className="size-toggle">
          <button
            type="button"
            className={size === 'full' ? 'is-on' : ''}
            onClick={() => setSize('full')}
          >
            full
          </button>
          <button
            type="button"
            className={size === 'collapsed' ? 'is-on' : ''}
            onClick={() => setSize('collapsed')}
          >
            small
          </button>
        </div>
        <div className="nf-actions">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setOpen(false)}
            disabled={create.isPending}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-solid btn-xs" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </form>
  )
}
