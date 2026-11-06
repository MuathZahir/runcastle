/**
 * A non-negative whole number an install may set by env var, else `fallback`:
 * the resume caps and the automatic compaction's thresholds read it, and each
 * takes `0` as "that check is off".
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}
