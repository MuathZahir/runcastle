import type { BranchList, FeatureListItem } from '../api'

/**
 * The default base branch every cutting form prefills with. A new feature forks
 * off the branch the user is currently on — that's the branch they chose to work
 * on, and burns never touch the checkout.
 *
 * Runcastle commonly serves the app from one of its own internal branches,
 * which is intentionally absent from creation pickers. In that case `main` is
 * the launch-time default promised by the Quick footer. A detached HEAD remains
 * empty because it supplies no checkout context from which to choose safely.
 */
export function defaultBaseBranch(data: Pick<BranchList, 'current' | 'branches'>): string {
  if (data.branches.includes(data.current)) return data.current
  return data.current && data.branches.includes('main') ? 'main' : ''
}

/**
 * The slug a title will get, for the branch line both creation forms preview.
 * A preview only — the server slugifies again (and deduplicates) on create, so
 * this never has to agree about a collision suffix, only about the shape.
 */
export function slugPreview(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * The New Feature form's inline "you already have one of these" note, or null.
 *
 * The form had no duplicate guard at all (findings F25.3): typing a title the
 * project already uses created a second feature with a suffixed branch and no
 * warning, and only the branch line hinted at it. This is a warning, never a
 * block — a deliberate second attempt at the same idea is legitimate, and the
 * server deduplicates the slug either way.
 *
 * Matching is on the SLUG, not the raw title, because that is what actually
 * collides: "Slack notifications" and "slack notifications!" become the same
 * branch name.
 */
export function duplicateTitleWarning(
  title: string,
  features: readonly Pick<FeatureListItem, 'title' | 'slug' | 'status'>[],
): string | null {
  const slug = slugPreview(title)
  if (slug === '') return null
  const existing = features.find((f) => f.slug === slug)
  if (!existing) return null
  const where = existing.status === 'shipped' ? 'was already shipped' : 'already exists'
  return `“${existing.title}” ${where} on feature/${existing.slug}. Creating this makes a second feature and a second branch.`
}

/**
 * Client-side feature derivations (UI-SPEC §2/§3): sidebar glyph, needs-me
 * classification, and the guided next step. Pure functions over wire data — no IO.
 */
