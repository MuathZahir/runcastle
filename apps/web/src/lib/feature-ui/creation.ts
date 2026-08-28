import type { BranchList, FeatureListItem } from '../api'

/**
 * The default base branch every cutting form prefills with. A new feature forks
 * off the branch the user is currently on — that's the branch they chose to work
 * on, and burns never touch the checkout.
 *
 * When the current checkout isn't a selectable base — a detached HEAD, or a test
 * drive holding runcastle itself on a `feature/*` branch (which the picker
 * excludes) — there is NO default: `''`, which every form renders as an empty,
 * mandatory select that blocks submit until a human picks (decision 8). It used
 * to fall back to the project main branch, and that silent substitution is the
 * one this feature exists to remove: mid-drive the checkout is parked on
 * something unrelated, so any guess about where to fork from is wrong.
 */
export function defaultBaseBranch(data: Pick<BranchList, 'current' | 'branches'>): string {
  return data.branches.includes(data.current) ? data.current : ''
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

