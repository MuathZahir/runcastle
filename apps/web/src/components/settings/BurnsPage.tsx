import { BURN_PREREQUISITES } from '../../lib/afk-rows'
import { pageRows } from '../../lib/settings'
import { DimLine } from '../../ui'
import { EnableAfkCard } from '../EnableAfkCard'
import { SettingGroup, SettingSection } from './SettingRow'
import { showsSetting, type SettingsPageProps } from './types'

/**
 * Burns: what an unattended run needs before it can start, and how wide and how
 * hard it tries once it does (decision 9).
 *
 * The prerequisites come first because they are the difference between a burn
 * that runs and one that cannot — and because every "Settings → Burns (Rebuild
 * image)" pointer in the app lands on a row of that checklist.
 */
export function BurnsPage({ globals, projectId, filter, highlightField }: SettingsPageProps) {
  if (globals.isLoading) return <DimLine>loading…</DimLine>
  if (globals.error) return <DimLine>could not load settings: {globals.error.message}</DimLine>
  if (!globals.data) return null

  // The checklist hides its own rows; the heading goes when none is left.
  const anyPrerequisite = BURN_PREREQUISITES.some((p) => showsSetting(filter, p.field))

  return (
    <div className="flex flex-col gap-5.5">
      {anyPrerequisite && (
        <SettingSection title="Prerequisites for unattended burns">
          <EnableAfkCard
            projectId={projectId}
            filter={filter}
            {...(highlightField ? { highlightField } : {})}
          />
        </SettingSection>
      )}
      <SettingGroup
        title="Width & retries"
        rows={pageRows(globals.data, 'burns')}
        filter={filter}
        highlightField={highlightField}
      />
    </div>
  )
}
