import { useEffect, useState } from 'react'

/** Trivial hash-based routing — home and per-feature pages (SPEC §10). */
export type Route = { name: 'home' } | { name: 'feature'; id: string }

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '')
  const m = h.match(/^\/feature\/([^/]+)/)
  if (m) return { name: 'feature', id: decodeURIComponent(m[1]) }
  return { name: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))
  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export function navigate(route: Route): void {
  window.location.hash =
    route.name === 'feature'
      ? `#/feature/${encodeURIComponent(route.id)}`
      : '#/'
}
