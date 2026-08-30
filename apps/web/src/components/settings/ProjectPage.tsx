import { useState } from 'react'
import { trpc } from '../../trpc'
import { pageRows, type SettingRow as Row, type SettingsGroup } from '../../lib/settings'
import type { ProjectFinding } from '../../lib/api'
import { DimLine } from '../../ui'
import { EvidencePopover } from './EvidencePopover'
import { SettingGroup } from './SettingRow'
import type { SettingsPageProps } from './types'

/**
 * This project: the ten fields a project may set for itself, grouped by task
 * (flow-redesign-settings, decisions 5 and 7).
 *
 * The global/project split is expressed *inside* a field rather than by a second
 * copy of it: a key with a global twin is ONE control, showing the inherited
 * value as ghost text under a `Global` chip until this project sets its own —
 * at which point the chip reads `This project` and carries the one action that
 * undoes it. The old surface said the same thing three times (an "Inherited
 * from global" sentence, an OVERRIDDEN badge and a "Clear override" link) and
 * still never showed what would actually run.
 *
 * Prepared values carry their provenance as a chip; the evidence behind it is a
 * popover, never the paragraphs it used to be.
 */

/** The three sections, in render order, with the heading each one carries. */
const GROUPS: readonly { group: SettingsGroup; title: string }[] = [
  { group: 'model', title: 'Model & sandbox' },
  { group: 'commands', title: 'Commands' },
  { group: 'chat', title: 'Project chat' },
]

export function ProjectPage({ scoped, projectId, filter, highlightField }: SettingsPageProps) {
  // The findings are the provenance behind the chips, and every write to a
  // prepared key re-sources one — so this query is invalidated alongside
  // `settings.get` by the row that issued the write.
  const prep = trpc.project.prep.useQuery({ projectId })
  /** The one row whose evidence is open — never two at once. */
  const [openEvidence, setOpenEvidence] = useState<string | null>(null)

  if (scoped.isLoading) return <DimLine>loading…</DimLine>
  if (scoped.error) return <DimLine>could not load settings: {scoped.error.message}</DimLine>
  if (!scoped.data) return null

  const findings = prep.data?.findings ?? []
  const byKey = new Map<string, ProjectFinding>(findings.map((f) => [f.key, f]))
  const rows = pageRows(scoped.data, 'project', findings)

  const evidence = (row: Row) => {
    const finding = byKey.get(row.key)
    if (openEvidence !== row.key || !finding?.evidence) return null
    return (
      <EvidencePopover
        source={finding.source}
        evidence={finding.evidence}
        onClose={() => setOpenEvidence(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5.5">
      {GROUPS.map(({ group, title }) => (
        <SettingGroup
          key={group}
          title={title}
          rows={rows.filter((row) => row.group === group)}
          projectId={projectId}
          filter={filter}
          highlightField={highlightField}
          onOpenEvidence={(key) => setOpenEvidence((open) => (open === key ? null : key))}
          evidence={evidence}
        />
      ))}
    </div>
  )
}
