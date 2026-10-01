import { useState } from 'react'
import type { BlockRef, DependencyRef } from '@runcastle/core'
import { stripMarkdown } from '../../lib/activity'
import type { FeatureListItem } from '../../lib/api'
import { dependencyState } from '../../lib/feature-ui/dependencies'
import { pathFor } from '../../lib/routes'
import { IconCheck, IconPlus, IconX } from '../../icons'
import { Button, IconButton, LINK, StatusLabel, cx, type StatusTone } from '../../ui'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../../ui/combobox'

/** The line a row of dependency facts sits on, under the header's meta line. */
const LINE = 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-tertiary'

function stateTone(d: DependencyRef): StatusTone {
  if (d.satisfied) return 'success'
  return d.status === 'archived' || d.status === 'draft' ? 'neutral' : 'accent'
}

function DependencyChip({ dep, onRemove }: { dep: DependencyRef; onRemove?: () => void }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm text-text">{dep.title}</span>
      <StatusLabel
        tone={stateTone(dep)}
        {...(dep.satisfied ? { icon: <IconCheck size={12} /> } : {})}
        title={dep.slug}
      >
        {dependencyState(dep)}
      </StatusLabel>
      {onRemove && (
        <IconButton label={`Stop waiting on ${dep.slug}`} size="sm" icon={<IconX />} onClick={onRemove} />
      )}
    </span>
  )
}

/**
 * What a feature waits on before it may start (ADR-0013 decision 4). On a draft
 * it is the one place the set is edited: ✕ drops an unmerged dependency, + Add
 * picks from `candidates`, and each change replaces the whole set through
 * `onChange`. A rejected change (a cycle, a dependency that merged meanwhile)
 * is said here, beside the edit that caused it. A merged dependency has no ✕ —
 * it gates nothing, and removing it would rewrite history.
 *
 * On a started feature the set is inert history: "Waited on: …", read-only,
 * and nothing at all when it never waited.
 */
export function DependenciesRow({
  isDraft,
  dependsOn,
  candidates,
  onChange,
}: {
  isDraft: boolean
  dependsOn: DependencyRef[]
  /** The features + Add offers — `dependencyCandidates`. */
  candidates: FeatureListItem[]
  /** Replace the set with these feature ids; rejects with the server's refusal. */
  onChange: (dependsOn: string[]) => Promise<unknown>
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!isDraft) {
    if (dependsOn.length === 0) return null
    return (
      <p className={LINE}>
        <span>Waited on:</span>
        {dependsOn.map((d) => (
          <DependencyChip key={d.featureId} dep={d} />
        ))}
      </p>
    )
  }

  const ids = dependsOn.map((d) => d.featureId)
  const replace = (next: string[]) => {
    setError(null)
    setPending(true)
    onChange(next)
      // The refusal is worded for agents too, in Markdown; this alert is plain text.
      .catch((e: unknown) => setError(stripMarkdown(e instanceof Error ? e.message : String(e))))
      .finally(() => setPending(false))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className={LINE}>
        <span>Waits on</span>
        {dependsOn.length === 0 && <span>nothing</span>}
        {dependsOn.map((d) => (
          <DependencyChip
            key={d.featureId}
            dep={d}
            {...(d.satisfied ? {} : { onRemove: () => replace(ids.filter((id) => id !== d.featureId)) })}
          />
        ))}
        <Combobox>
          <ComboboxTrigger asChild>
            <Button variant="ghost" size="sm" icon={<IconPlus />} loading={pending}>
              Add
            </Button>
          </ComboboxTrigger>
          <ComboboxContent align="start">
            <ComboboxInput placeholder="Find a feature…" />
            <ComboboxList label="Features to wait on">
              <ComboboxEmpty>No unmerged feature to wait on</ComboboxEmpty>
              {candidates.map((f) => (
                <ComboboxItem key={f.id} value={`${f.title} ${f.slug}`} onSelect={() => replace([...ids, f.id])}>
                  {f.title}
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      {error && (
        <p className="m-0 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The drafts still waiting on this feature (ADR-0013 decision 6) — read-only,
 * because the edge is edited from the dependent's side. Shown so the edge is
 * in view before this feature is archived or deleted.
 */
export function BlocksLine({ projectId, blocks }: { projectId: string; blocks: BlockRef[] }) {
  if (blocks.length === 0) return null
  return (
    <p className={LINE}>
      <span>Blocks:</span>
      {blocks.map((b, i) => (
        <span key={b.featureId}>
          <a className={cx(LINK, 'font-mono')} href={pathFor({ kind: 'feature', projectId, featureSlug: b.slug })} title={b.title}>
            {b.slug}
          </a>
          {i < blocks.length - 1 && ','}
        </span>
      ))}
    </p>
  )
}
