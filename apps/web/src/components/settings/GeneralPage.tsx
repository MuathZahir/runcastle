import { pageRows } from '../../lib/settings'
import { DimLine } from '../../ui'
import { SettingGroup } from './SettingRow'
import type { SettingsPageProps } from './types'

/**
 * General: the machine-wide settings that are neither about models nor about
 * burns — the port the server listens on, and how a launched session is
 * sandboxed and what tools it can see.
 */
export function GeneralPage({ globals, filter, highlightField }: SettingsPageProps) {
  if (globals.isLoading) return <DimLine>loading…</DimLine>
  if (globals.error) return <DimLine>could not load settings: {globals.error.message}</DimLine>
  if (!globals.data) return null

  const rows = pageRows(globals.data, 'general')
  const group = (name: 'server' | 'sessions') => rows.filter((row) => row.group === name)

  return (
    <div className="flex flex-col gap-5.5">
      <SettingGroup
        title="Server"
        rows={group('server')}
        filter={filter}
        highlightField={highlightField}
      />
      <SettingGroup
        title="Sessions"
        rows={group('sessions')}
        filter={filter}
        highlightField={highlightField}
      />
    </div>
  )
}
