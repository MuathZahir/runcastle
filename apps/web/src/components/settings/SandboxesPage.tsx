import { BURN_PREREQUISITES } from '../../lib/afk-rows'
import { pageRows } from '../../lib/settings'
import { DimLine } from '../../ui'
import { EnableAfkCard } from '../EnableAfkCard'
import { SettingGroup, SettingSection, SettingsSkeleton } from './SettingRow'
import { showsSetting, type SettingsPageProps } from './types'

/**
 * Sandboxes: what a worker's sandbox needs before it can start (the image, the
 * dependency cache), and how many workers work at once and on how many cores
 * (burns-become-workers decision 18).
 *
 * The prerequisites come first because they are the difference between a
 * worker that starts and one that cannot — and because every "Settings →
 * Sandboxes (Rebuild image)" pointer in the app lands on a row of that checklist.
 */
/** Label widths for the placeholder rows: Prerequisites · Workers. */
export const SANDBOXES_SKELETON = [['w-32', 'w-28', 'w-36'], ['w-20', 'w-24']] as const

export function SandboxesPage({ globals, projectId, filter, highlightField }: SettingsPageProps) {
  if (globals.isLoading) return <SettingsSkeleton groups={SANDBOXES_SKELETON} />
  if (globals.error) return <DimLine>Could not load settings: {globals.error.message}</DimLine>
  if (!globals.data) return null

  // The checklist hides its own rows; the heading goes when none is left.
  const anyPrerequisite = BURN_PREREQUISITES.some((p) => showsSetting(filter, p.field))

  return (
    <>
      {anyPrerequisite && (
        <SettingSection title="Prerequisites for unattended workers">
          <EnableAfkCard projectId={projectId} filter={filter} highlightField={highlightField} />
        </SettingSection>
      )}
      <SettingGroup
        title="Workers at once"
        rows={pageRows(globals.data, 'sandboxes')}
        filter={filter}
        highlightField={highlightField}
      />
    </>
  )
}
