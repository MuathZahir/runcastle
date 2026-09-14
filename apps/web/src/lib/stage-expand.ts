import { useEffect } from 'react'

/**
 * The evidence stage's expanded state (decisions 3–4): one expand for the live
 * drive and the walkthrough alike, held by the review page rather than by either
 * player, so switching sides while expanded stays expanded.
 *
 * Expanded is a CSS overlay over the workspace and NOT the native Fullscreen
 * API, which shows the fullscreened element and nothing else — the notes rail
 * and the transport bar would both vanish, which is what made the walkthrough's
 * old F key a viewing mode when the human needs a working one.
 *
 * A stage is handed one by the page that has somewhere to expand INTO. The
 * shipped record plays its walkthrough on the same stage and has no such place,
 * so it hands none, and that stage offers no expand at all.
 */
export interface StageExpand {
  expanded: boolean
  set: (next: boolean) => void
}

/** Whether a keystroke belongs to something being typed into rather than to us. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable === true
}

/**
 * F toggles the expand and Escape collapses it, bound by whatever is ON the
 * stage — the player while a recording is playing, the stage itself while it is
 * the drive. Binding it there rather than once above both is what keeps the
 * player's guards: a surface that has taken the keyboard for itself (the
 * annotation overlay, mid-drawing) keeps it by simply not enabling this.
 */
export function useStageExpandKeys(expand: StageExpand | undefined, enabled: boolean): void {
  const expanded = expand?.expanded ?? false
  const set = expand?.set
  useEffect(() => {
    if (!enabled || !set) return
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        set(!expanded)
      } else if (e.key === 'Escape' && expanded) {
        e.preventDefault()
        set(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, expanded, set])
}
