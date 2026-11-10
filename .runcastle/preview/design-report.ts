import { useEffect, useState } from 'react'
import type { DesignReport } from '@runcastle/core'

/**
 * A design page's report to the Design tab around it
 * (agents-see-the-tweaks-you-picked, the design guide's section 4): its
 * switcher's current state and its tweak values, posted to the parent window on
 * load and on every change. Approve hands the values to the lead.
 *
 * Every design page reports, single-state ones included: `state` null without a
 * switcher, `tweaks` `{}` without a Tweaks menu.
 *
 *   const [tweaks, setTweak] = useDesignTweaks({ accent: 'teal', density: 'compact' })
 *   useDesignReport(state, tweaks)
 */
export type Tweaks = NonNullable<DesignReport['tweaks']>

/** Post the page's state and tweaks to the Design tab whenever either changes. */
export function useDesignReport(state: string | null, tweaks: Tweaks = {}): void {
  const key = JSON.stringify([state, tweaks])
  useEffect(() => {
    const report: DesignReport = { type: 'runcastle:design', state, tweaks }
    if (window.parent !== window) window.parent.postMessage(report, '*')
    // `key` stands for state and tweaks, compared by value.
  }, [key])
}

/** Where a page keeps its tweaks: by its own path, so two designs on one server keep their own. */
const storageKey = () => `runcastle:tweaks:${window.location.pathname}`

/**
 * The Tweaks menu's values, kept in this browser under the page's path and
 * restored on load, so a reload shows the human's picks rather than the defaults.
 */
export function useDesignTweaks<T extends Tweaks>(defaults: T): [T, (name: keyof T & string, value: T[keyof T]) => void] {
  const [tweaks, setTweaks] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) ?? '{}') as Partial<T>
      return { ...defaults, ...saved }
    } catch {
      return defaults
    }
  })
  const setTweak = (name: keyof T & string, value: T[keyof T]) =>
    setTweaks((current) => {
      const next = { ...current, [name]: value }
      localStorage.setItem(storageKey(), JSON.stringify(next))
      return next
    })
  return [tweaks, setTweak]
}
