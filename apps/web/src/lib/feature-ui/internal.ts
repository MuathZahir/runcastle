import type { FeatureFull } from '../api'
import { PREPARED_LABEL } from '../settings'

export function hasResumable(sessions: FeatureFull['sessions'], kind?: string): boolean {
  return sessions.some(
    (session) =>
      (!kind || session.kind === kind) && session.status === 'ended' && !!session.ccSessionId,
  )
}

export function unverifiedWarning(keys: string[]): string {
  const named = keys.map((key) => PREPARED_LABEL[key] ?? key)
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
  return `${list} ${named.length === 1 ? 'was' : 'were'} never proven by a dry run — run preparation to verify.`
}
