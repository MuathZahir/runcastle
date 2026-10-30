/**
 * The feature page's one panel (design-mode decisions 4, 5): the chat is the
 * page, and a single panel opens on its right holding one view at a time.
 * Pure — which views a feature offers, and the reducer for what the panel does.
 * The page owns where the state lives (the open view is the shell's, so the
 * address bar names it) and the storage the size persists in.
 */

/**
 * What the panel can show, one at a time: three fixed views — Plan, Tickets
 * (`work`), Details — and Design and Drive while they run
 * (the-feature-s-right-panel decisions 14, 17).
 */
export type PanelView = 'plan' | 'work' | 'details' | 'design' | 'drive'

/** Every view, in the order the switcher and the topbar list them. */
export const PANEL_VIEWS: readonly PanelView[] = ['plan', 'work', 'details', 'design', 'drive']

export function isPanelView(value: string): value is PanelView {
  return (PANEL_VIEWS as readonly string[]).includes(value)
}

/**
 * The retired views' names, and the fixed view each became: the phase body's
 * tickets, the plan preview, and Review, whose findings are the review
 * ticket's row now (the-feature-s-right-panel decision 15).
 */
const RETIRED_VIEWS: Readonly<Record<string, PanelView>> = { body: 'work', preview: 'plan', review: 'work' }

/** A view name read from an address or an event, the retired `body`, `preview` and `review` mapped onto Tickets and Plan. */
export function panelViewOf(value: string): PanelView | null {
  return isPanelView(value) ? value : (RETIRED_VIEWS[value] ?? null)
}

/**
 * Who opened the panel. Runcastle opens it only as the result of the human's
 * own click (decision 5), so its opens go through `follow`, never `open`.
 */
export type PanelOrigin = 'human' | 'agent' | 'runcastle'

/** The human's clicks runcastle answers by opening a view: Test drive opens the drive. */
export type PanelFollowedClick = 'testDrive'

const FOLLOWS: Record<PanelFollowedClick, PanelView> = { testDrive: 'drive' }

/** The facts that decide which views a feature offers. */
export interface PanelFacts {
  /** A draft has no chat, so its body is the page and it has no panel at all. */
  isDraft: boolean
  /** A plan preview, decisions.md or spec.md exists. */
  hasPlan: boolean
  /** The feature has any ticket. */
  hasTickets: boolean
  shipped: boolean
  /** A design server runs for the feature. */
  designRunning: boolean
  /** A drive of the feature is up. */
  driveActive: boolean
}

/** The plan documents the Plan view leads with, after the preview. */
export const PLAN_DOCS = ['decisions.md', 'spec.md'] as const

/** Whether a feature has a plan to read: a preview, decisions.md or spec.md. */
export function hasPlan(full: { preview?: unknown; docs: readonly { relPath: string }[] }): boolean {
  return !!full.preview || full.docs.some((doc) => PLAN_DOCS.some((name) => doc.relPath.endsWith(name)))
}

/**
 * The views a feature offers right now, each once it has something to show:
 * Plan once there is a plan to read, Tickets once there is a ticket, Details
 * always, and Design and Drive only while they run.
 */
export function availableViews(facts: PanelFacts): PanelView[] {
  if (facts.isDraft) return []
  const offered: Record<PanelView, boolean> = {
    plan: facts.hasPlan,
    work: facts.hasTickets,
    details: true,
    design: facts.designRunning,
    drive: facts.driveActive,
  }
  return PANEL_VIEWS.filter((view) => offered[view])
}

/**
 * The views the panel's own tabs and toggle deal in. A drive is the page, not
 * something the panel shows (test-drive-looks-the-part): it stays among the
 * offered views so the shell can stand on it, but it is entered from the
 * header, the sidebar's drive card or Test drive, never from a tab.
 */
export function panelTabs(views: readonly PanelView[]): PanelView[] {
  return views.filter((view) => view !== 'drive')
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
  return view === 'details' ? 'Notes' : PANEL_VIEW_LABEL[view]
}

/** The event the agent's `show_panel` tool emits (design-mode spec, Events). */
export const PANEL_SHOW_EVENT = 'panel.show'

export interface PanelShowRequest {
  view: PanelView
  path?: string
  /** For the design view: the screen width the agent asked to lay the page out at. */
  width?: number
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
  const data = (event.data ?? {}) as { view?: unknown; path?: unknown; width?: unknown }
  const view = typeof data.view === 'string' ? panelViewOf(data.view) : null
  if (!view) return null
  return {
    view,
    ...(typeof data.path === 'string' ? { path: data.path } : {}),
    ...(typeof data.width === 'number' && Number.isInteger(data.width) && data.width > 0 ? { width: data.width } : {}),
  }
}

export const PANEL_VIEW_LABEL: Record<PanelView, string> = {
  plan: 'Plan',
  work: 'Tickets',
  design: 'Design',
  drive: 'Drive',
  details: 'Details',
}

export interface PanelState {
  /** The view on show, or null for the chat alone. */
  view: PanelView | null
  /** Where in the design server the design view points (decision 3). */
  path?: string
  /** The screen width the agent opened the design view at; unset, the human's remembered one holds. */
  width?: number
  origin?: PanelOrigin
  /** The panel's share of the row, 0 (the chat alone) to 1 (the panel full). */
  share: number
  /** Folded to a strip at the row's edge. */
  collapsed: boolean
  /** The view last on show — where the header's panel toggle reopens it (decision 12). */
  last?: PanelView
  /**
   * The feature doc (a relPath) read in place of the open view's body
   * (the-feature-s-right-panel decision 7); its way back is that view.
   */
  doc?: string
}

/** Where a fresh browser starts: an even split. */
export const HALF = 0.5

export const INITIAL_PANEL: PanelState = { view: null, share: HALF, collapsed: false }

export type PanelAction =
  | { type: 'open'; view: PanelView; path?: string; width?: number; origin: Exclude<PanelOrigin, 'runcastle'> }
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
  /** Read a doc in the open view (decision 7): it unfolds a folded panel, since the click asked to see it. */
  | { type: 'openDoc'; doc: string }
  /** The reader's way back: the open view's own body again. */
  | { type: 'closeDoc' }

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
    case 'open': {
      const opened = withView(state, action.view, action.origin, action.path)
      if (action.view !== 'design') return opened
      // A width holds for the design open that asked for it: the next one
      // without a width goes back to the human's remembered width.
      const { width: _width, ...rest } = opened
      return action.width !== undefined ? { ...rest, width: action.width } : rest
    }
    case 'follow':
      return withView(state, FOLLOWS[action.click], 'runcastle')
    case 'switch':
      // Even the open view's own tab: the click asks for the view, not the doc.
      return withView(withoutDoc(state), action.view, 'human')
    case 'close': {
      const { path: _path, width: _width, origin: _origin, doc: _doc, ...rest } = state
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
    case 'openDoc':
      return state.view ? { ...state, doc: action.doc, collapsed: false } : state
    case 'closeDoc':
      return withoutDoc(state)
  }
}

function withoutDoc(state: PanelState): PanelState {
  const { doc: _doc, ...rest } = state
  return rest
}

/**
 * The design path outlives a switch to another view, so coming back to design
 * — by the switcher or the topbar — lands where it was; only a new design
 * path replaces it. An open doc belongs to its view, so another view drops it.
 */
function withView(state: PanelState, view: PanelView, origin: PanelOrigin, path?: string): PanelState {
  return {
    ...(view === state.view ? state : withoutDoc(state)),
    view,
    last: view,
    origin,
    collapsed: false,
    ...(view === 'design' && path !== undefined ? { path } : {}),
  }
}
