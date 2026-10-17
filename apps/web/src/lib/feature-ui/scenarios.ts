import type { DriveScenario, ScenarioEntry } from '@runcastle/core'

/**
 * The scenario list a drive offers (drive-scenarios decision 7), in the order
 * both the Test drive picker and a running drive's Scenario menu show it: the
 * feature's own scenarios, then every other scenario by group (ungrouped last),
 * then Blank app — which is not a section here, because it is always there.
 */
export interface ScenarioMenu {
  /** "This feature": the files the feature's branch added or changed, in path order. */
  own: ScenarioEntry[]
  /** Everything else, ordered by group with the ungrouped last, then by path. */
  others: ScenarioEntry[]
  /** The heading over {@link others}: "Other scenarios" beside an own section, else "Scenarios". */
  othersLabel: string
  /** What the main click starts with: the first own scenario, or null for Blank app. */
  defaultScenario: ScenarioEntry | null
}

const byPath = (a: ScenarioEntry, b: ScenarioEntry): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)

/**
 * Sections from the server's list. `withOwnSection` is false on a project drive,
 * which has no feature to own anything — its scenarios are all one list and it
 * defaults to Blank app. With no runner configured nothing can run, so only
 * Blank app is offered (spec "Discovery").
 */
export function scenarioMenu(
  scenarios: readonly ScenarioEntry[],
  { withOwnSection, runnerConfigured }: { withOwnSection: boolean; runnerConfigured: boolean },
): ScenarioMenu {
  if (!runnerConfigured) {
    return { own: [], others: [], othersLabel: 'Scenarios', defaultScenario: null }
  }
  const own = withOwnSection ? scenarios.filter((s) => s.own).sort(byPath) : []
  const others = scenarios
    .filter((s) => !own.includes(s))
    .sort((a, b) => {
      // Ungrouped last; groups alphabetically; within a group, path order.
      if (!a.group !== !b.group) return a.group ? -1 : 1
      const group = (a.group ?? '').localeCompare(b.group ?? '')
      return group !== 0 ? group : byPath(a, b)
    })
  return {
    own,
    others,
    othersLabel: withOwnSection ? 'Other scenarios' : 'Scenarios',
    defaultScenario: own[0] ?? null,
  }
}

/** The main click's label: what it starts on, said before the click. */
export function testDriveLabel(defaultScenario: ScenarioEntry | null, fallback: string): string {
  return defaultScenario ? `Test drive · ${defaultScenario.name}` : fallback
}

/**
 * Where the drive panel points: a landed scenario's entry URL, else the app's
 * plain URL — a failed or running scenario leaves the app where Blank app
 * would (decision 3). `key` remounts the frame per landing, so landing on the
 * same URL twice still reloads it.
 */
export function scenarioTarget(devUrl: string, scenario: DriveScenario | undefined): { url: string; key: string } {
  if (scenario?.status === 'landed' && scenario.entryUrl) {
    return { url: scenario.entryUrl, key: scenario.landingId ?? scenario.entryUrl }
  }
  return { url: devUrl, key: 'plain' }
}

/**
 * The Blank app nudge (decision 14): shown on a drive in no scenario while the
 * project has none at all — a fact, not a stored flag, so it is gone for good
 * with the first scenario. `scenarios` is undefined while the list loads, which
 * shows nothing rather than a flash. `dismissed` is this drive's ✕.
 */
export function showsScenarioNudge({
  scenario,
  scenarios,
  dismissed,
}: {
  scenario: DriveScenario | undefined
  scenarios: readonly ScenarioEntry[] | undefined
  dismissed: boolean
}): boolean {
  return !dismissed && !scenario && scenarios !== undefined && scenarios.length === 0
}

/**
 * The failure strip's headline, with the actual reason — the human asked that
 * the error itself be shown, not just the fact of a failure (decision 3).
 */
export function scenarioFailureLine(scenario: Pick<DriveScenario, 'name' | 'failure'>): string {
  const failure = scenario.failure
  const why = !failure
    ? 'failed'
    : failure.reason === 'exit'
      ? typeof failure.exitCode === 'number'
        ? `exit ${failure.exitCode}`
        : 'exited without a code'
      : failure.reason === 'no-entry-url'
        ? 'printed no ENTRY_URL'
        : failure.reason === 'timeout'
          ? 'timed out after 2 min'
          : 'no scenario runner set'
  return `Scenario “${scenario.name}” failed: ${why}`
}
