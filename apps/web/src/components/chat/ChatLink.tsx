import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'
import type { FeatureListItem } from '../../lib/api'
import { parseChatLink } from '../../lib/chat-links'
import { pathFor } from '../../lib/routes'
import { THREAD_PARAM } from '../../lib/use-history-sync'
import { LINK } from '../../ui/button'

/** Where a worker's chat lives: its feature, by id and slug. */
export interface WorkerPlace {
  featureId: string
  slug: string
}

/**
 * What a `feature:` or `worker:` link in an agent's chat resolves against and
 * opens with (chats-link-to-what-they-name). The project shell provides it, so
 * every chat under it shares the sidebar's way of opening a feature (decision
 * 3). A chat outside a shell (a scenario page) has none: its links read as
 * their words.
 */
export interface ChatLinks {
  projectId: string
  /** Every feature of the project, whatever its state (decision 7). */
  features: readonly Pick<FeatureListItem, 'id' | 'slug'>[]
  /** Open a feature as a sidebar click does, or on its Plan or Design tab. */
  openFeature: (featureId: string, view?: 'plan' | 'design') => void
  /** Open a worker's chat in its feature. */
  openWorker: (featureId: string, workerId: string) => void
  /** A hook: the worker's feature, or null while it loads and for an id that names no feature's worker. */
  useWorkerPlace: (workerId: string) => WorkerPlace | null
}

export const ChatLinksContext = createContext<ChatLinks | null>(null)

/**
 * A plain left click opens in place, through the shell, so Back returns
 * (decision 8); a modified or middle click is the browser's (a new tab).
 */
function inPlace(open: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    open()
  }
}

function Resolved({ href, open, children }: { href: string; open: () => void; children: ReactNode }) {
  return (
    <a className={LINK} href={href} onClick={inPlace(open)}>
      {children}
    </a>
  )
}

function WorkerLink({ links, id, children }: { links: ChatLinks; id: string; children: ReactNode }) {
  const place = links.useWorkerPlace(id)
  if (!place) return <>{children}</>
  const path = pathFor({ kind: 'feature', projectId: links.projectId, featureSlug: place.slug, view: 'chat' })
  return (
    <Resolved href={`${path}?${new URLSearchParams({ [THREAD_PARAM]: id })}`} open={() => links.openWorker(place.featureId, id)}>
      {children}
    </Resolved>
  )
}

/**
 * A runcastle link in an agent's chat: the app's one link look, with the
 * target's real address, when it resolves; its words in plain text when it
 * does not, is malformed, or has no links to resolve against (decision 4).
 */
export function ChatLink({ href, children }: { href: string; children: ReactNode }) {
  const links = useContext(ChatLinksContext)
  const target = parseChatLink(href)
  if (!links || !target) return <>{children}</>
  if (target.kind === 'worker') return <WorkerLink links={links} id={target.id}>{children}</WorkerLink>
  const feature = links.features.find((f) => f.slug === target.slug)
  if (!feature) return <>{children}</>
  const { view } = target
  const path = pathFor({
    kind: 'feature',
    projectId: links.projectId,
    featureSlug: feature.slug,
    ...(view ? { view } : {}),
  })
  return (
    <Resolved href={path} open={() => links.openFeature(feature.id, view)}>
      {children}
    </Resolved>
  )
}
