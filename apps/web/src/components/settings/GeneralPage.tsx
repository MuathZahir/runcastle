import type { ReactNode } from 'react'
import { pageRows } from '../../lib/settings'
import { useTheme, type ThemePreference } from '../../lib/theme'
import { DimLine, Loading, SegmentedControl, Spinner } from '../../ui'
import { IconMonitor, IconMoon, IconSun } from '../../icons'
import { SettingGroup, SettingLine, SettingSection } from './SettingRow'
import { showsSetting, type SettingsPageProps } from './types'

/**
 * General: how the app looks, and the machine-wide settings that are neither
 * about models nor about burns — the port the server listens on, and how a
 * launched session is sandboxed and what tools it can see.
 */

/** The theme row's filter id. It is a browser preference, not a setting key. */
export const THEME_FIELD = 'theme'

const THEMES: readonly { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: 'dark', label: 'Dark', icon: <IconMoon size={14} /> },
  { value: 'light', label: 'Light', icon: <IconSun size={14} /> },
  { value: 'system', label: 'System', icon: <IconMonitor size={14} /> },
]

export function GeneralPage({ globals, filter, highlightField }: SettingsPageProps) {
  const appearance = showsSetting(filter, THEME_FIELD) && (
    <SettingSection title="Appearance">
      <ThemeRow />
    </SettingSection>
  )

  if (globals.isLoading)
    return (
      <>
        {appearance}
        <Loading className="mt-9">Loading settings…</Loading>
      </>
    )
  if (globals.error)
    return (
      <>
        {appearance}
        <DimLine>Could not load settings: {globals.error.message}</DimLine>
      </>
    )
  if (!globals.data) return <>{appearance}</>

  const rows = pageRows(globals.data, 'general')
  const group = (name: 'server' | 'sessions') => rows.filter((row) => row.group === name)

  return (
    <>
      {appearance}
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
    </>
  )
}

/**
 * Dark, light, or whatever the OS says. A browser preference (`localStorage`),
 * so it applies the moment it is picked and never goes to the server. Three
 * values, all worth seeing at once: a segmented control, not a dropdown.
 */
function ThemeRow() {
  const { preference, setPreference } = useTheme()
  return (
    <SettingLine
      label="Theme"
      description="Dark is the default; System follows your operating system as it changes."
      control={
        <SegmentedControl
          id="settings-theme"
          label="Theme"
          items={THEMES.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))}
          value={preference}
          onChange={setPreference}
          className="w-full"
        />
      }
    />
  )
}
