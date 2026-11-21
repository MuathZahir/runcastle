/**
 * What an agent links in its chat text (chats-link-to-what-they-name decisions
 * 1, 2): a markdown link whose target names a runcastle thing.
 *
 *   feature:<slug>          a feature, opened as a sidebar click opens it
 *   feature:<slug>/plan     its Details tab (the retired Plan tab's name)
 *   feature:<slug>/design   its Design tab
 *   worker:<worker id>      that worker's chat, in its feature
 *
 * This module is the pure half: which hrefs are ours and what they name.
 */

export type ChatLinkTarget =
  | { kind: 'feature'; slug: string; view?: 'details' | 'design' }
  | { kind: 'worker'; id: string }

const FEATURE = 'feature:'
const WORKER = 'worker:'

/** One name in a target: non-empty, no slash, no whitespace. */
const NAME = /^[^\s/]+$/

/** Whether an href uses one of our schemes, well-formed or not — such a link never reaches the browser. */
export function isChatLinkHref(href: string): boolean {
  return href.startsWith(FEATURE) || href.startsWith(WORKER)
}

function decoded(part: string): string | null {
  try {
    return decodeURIComponent(part)
  } catch {
    return null
  }
}

/** What an href names, or null for any other link and for a malformed target (`feature:`, `feature:x/drive`, `worker:`). */
export function parseChatLink(href: string): ChatLinkTarget | null {
  if (href.startsWith(WORKER)) {
    const id = decoded(href.slice(WORKER.length))
    return id !== null && NAME.test(id) ? { kind: 'worker', id } : null
  }
  if (!href.startsWith(FEATURE)) return null
  const parts = href.slice(FEATURE.length).split('/')
  if (parts.length > 2) return null
  const slug = decoded(parts[0] ?? '')
  if (slug === null || !NAME.test(slug)) return null
  const view = parts[1]
  if (view === undefined) return { kind: 'feature', slug }
  // The retired Plan tab's link opens Details, where its docs are read now.
  if (view === 'plan') return { kind: 'feature', slug, view: 'details' }
  return view === 'design' ? { kind: 'feature', slug, view } : null
}
