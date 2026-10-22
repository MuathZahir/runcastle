import type { Phase } from '@runcastle/core'

/**
 * The feature page's one panel (design-mode decisions 4, 5): the chat is the
 * page, and a single panel opens on its right holding one view at a time.
 * Pure — which views a feature offers, and the reducer for what the panel does.
 * The page owns where the state lives (the open view is the shell's, so the
 * address bar names it) and the storage the size persists in.
 */

/** What the panel can show, one at a time. */
export type PanelView = 'body' | 'preview' | 'design' | 'drive' | 'details'

/** Every view, in the order the switcher and the topbar list them. */
export const PANEL_VIEWS: readonly PanelView[] = ['body', 'preview', 'design', 'drive', 'details']

export function isPanelView(value: string): value is PanelView {
  return (PANEL_VIEWS as readonly string[]).includes(value)
}

/**
 * Who opened the panel. Runcastle opens it only as the result of the human's
 * own click (decision 5), so its opens go through `follow`, never `open`.
 */
export type PanelOrigin = 'human' | 'agent' | 'runcastle'

/** The human's clicks runcastle answers by opening a view: Go opens the run, Test drive the drive. */
export type PanelFollowedClick = 'go' | 'testDrive'

const FOLLOWS: Record<PanelFollowedClick, PanelView> = { go: 'body', testDrive: 'drive' }

/**
 * The views a feature offers right now. A draft has no chat, so its body is
 * the page and it has no panel at all. The plan preview is offered once one
 * exists, the drive only while one is up, and design until the feature ships
 * (its server stops then — design-mode decision 10).
 */
export function availableViews({
  isDraft,
  phase,
  hasPreview,
  driveActive,
}: {
  isDraft: boolean
  phase: Phase
  hasPreview: boolean
  driveActive: boolean
}): PanelView[] {
  if (isDraft) return []
  return PANEL_VIEWS.filter((view) => {
    switch (view) {
      case 'preview':
        return hasPreview
      case 'design':
        return phase !== 'shipped'
      case 'drive':
        return driveActive
      default:
        return true
    }
  })
}

/**
 * The views the project page's panel offers (design-mode decision 11): the
 * project drive while one is up, and the Notes inbox as its details once the
 * project has jotted a note.
 */
export function projectViews({ driveActive, hasNotes }: { driveActive: boolean; hasNotes: boolean }): PanelView[] {
  return [...(driveActive ? (['drive'] as const) : []), ...(hasNotes ? (['details'] as const) : [])]
}

/** What the project page calls its views: its details are the Notes inbox. */
export function projectViewLabel(view: PanelView): string {
  return view === 'details' ? 'Notes' : view === 'body' ? 'Project' : PANEL_VIEW_LABEL[view]
}

/** The event the agent's `show_panel` tool emits (design-mode spec, Events). */
export const PANEL_SHOW_EVENT = 'panel.show'

export interface PanelShowRequest {
  view: PanelView
  path?: string
}

/**
 * The view an event asks this feature's panel to open, or null — for any other
 * event, for another feature's `panel.show`, and for a view this build does
 * not know.
 */
export function panelShowRequest(
  event: { type: string; featureId?: string; data?: unknown },
  featureId: string,
): PanelShowRequest | null {
  if (event.type !== PANEL_SHOW_EVENT || event.featureId !== featureId) return null
  const data = (event.data ?? {}) as { view?: unknown; path?: unknown }
  if (typeof data.view !== 'string' || !isPanelView(data.view)) return null
  return typeof data.path === 'string' ? { view: data.view, path: data.path } : { view: data.view }
}

/** What the phase body is called in the switcher and on its topbar button. */
export function bodyLabel(phase: Phase, { ticketsIsBody, hasRun }: { ticketsIsBody: boolean; hasRun: boolean }): string {
  switch (phase) {
    case 'planning':
      return ticketsIsBody ? 'Tickets' : 'Plan'
    case 'building':
      return hasRun ? 'Run' : 'Tickets'
    case 'review':
      return 'Review'
    case 'shipped':
      return 'Outcome'
  }
}

export const PANEL_VIEW_LABEL: Record<Exclude<PanelView, 'body'>, string> = {
  preview: 'Preview',
  design: 'Design',
  drive: 'Drive',
  details: 'Details',
}

export interface PanelState {
  /** The view on show, or null for the chat alone. */
  view: PanelView | null
  /** Where in the design server the design view points (decision 3). */
  path?: string
  origin?: PanelOrigin
  /** The panel's share of the row, 0 (the chat alone) to 1 (the panel full). */
  share: number
  /** Folded to a strip at the row's edge. */
  collapsed: boolean
  /** The view last on show — where the header's panel toggle reopens it (decision 12). */
  last?: PanelView
}

/** Where a fresh browser starts: an even split. */
export const HALF = 0.5

export const INITIAL_PANEL: PanelState = { view: null, share: HALF, collapsed: false }

export type PanelAction =
  | { type: 'open'; view: PanelView; path?: string; origin: Exclude<PanelOrigin, 'runcastle'> }
  /** Runcastle's one way in: the view the human's own click leads to. */
  | { type: 'follow'; click: PanelFollowedClick }
  | { type: 'close' }
  | { type: 'switch'; view: PanelView }
  /** A drag's measurement — either side may shrink to nothing. */
  | { type: 'setWidth'; share: number }
  /** The divider's double-click: panel full, or back to an even split. */
  | { type: 'toggleFull' }
  | { type: 'collapse' }
  | { type: 'expand' }
  /**
   * The header's panel toggle (decision 12): close the open panel, or open it
   * at its last view — the first of `views` when that one is not offered now.
   */
  | { type: 'toggle'; views: readonly PanelView[] }

/** A share inside 0..1; anything non-finite reads as the even split. */
export function clampShare(share: number): number {
  if (!Number.isFinite(share)) return HALF
  return Math.min(1, Math.max(0, share))
}

/**
 * The panel's transitions. Opening or switching to a view always unfolds the
 * panel, since the click asked to see it; the size is the human's, kept
 * across views. A path is only the design view's.
 */
export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'open':
      return withView(state, action.view, action.origin, action.path)
    case 'follow':
      return withView(state, FOLLOWS[action.click], 'runcastle')
    case 'switch':
      return withView(state, action.view, 'human')
    case 'close': {
      const { path: _path, origin: _origin, ...rest } = state
      // The view the shell opened (the address bar, the palette) counts as last too.
      const last = state.view ?? state.last
      return { ...rest, view: null, collapsed: false, ...(last ? { last } : {}) }
    }
    case 'setWidth':
      return { ...state, share: clampShare(action.share) }
    case 'toggleFull':
      return { ...state, share: state.share >= 1 ? HALF : 1, collapsed: false }
    case 'collapse':
      return state.view ? { ...state, collapsed: true } : state
    case 'expand':
      return { ...state, collapsed: false }
    case 'toggle': {
      if (state.view) return panelReducer(state, { type: 'close' })
      const view = state.last && action.views.includes(state.last) ? state.last : action.views[0]
      return view ? withView(state, view, 'human') : state
    }
  }
}

/**
 * The design path outlives a switch to another view, so coming back to design
 * — by the switcher or the topbar — lands where it was; only a new design
 * path replaces it.
 */
function withView(state: PanelState, view: PanelView, origin: PanelOrigin, path?: string): PanelState {
  return {
    ...state,
    view,
    last: view,
    origin,
    collapsed: false,
    ...(view === 'design' && path !== undefined ? { path } : {}),
  }
}
