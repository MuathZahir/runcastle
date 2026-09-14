import { clampRailWidth, useRailWidth, type RailWidth, type RailWidthSpec } from './rail-width'

/**
 * How wide the review page's notes rail is.
 *
 * The rail is permanent (decision 2), so its width is the one thing about it a
 * human still chooses: a note-heavy session wants the room, a screenshot-heavy
 * one wants the stage. 360px is what the approved prototype pins — enough for a
 * note row's whole anatomy (thumbnail, timestamp, prose) without starving the
 * stage at a typical window width.
 */

/** Narrow enough that a note row still reads; the prototype's lower clamp. */
export const NOTES_RAIL_MIN_W = 260
/** Wide enough for a screenshot-heavy session, before the rail eats the stage. */
export const NOTES_RAIL_MAX_W = 560
/** The prototype's approved default, and the value `--notes-rail-w` declares. */
export const NOTES_RAIL_DEFAULT_W = 360

const NOTES_RAIL: RailWidthSpec = {
  key: 'runcastle.notesrail.w',
  min: NOTES_RAIL_MIN_W,
  max: NOTES_RAIL_MAX_W,
  default: NOTES_RAIL_DEFAULT_W,
}

/** A width in pixels, held inside the clamp. Non-finite input reads as the default. */
export function clampNotesRailWidth(px: number): number {
  return clampRailWidth(NOTES_RAIL, px)
}

/** The rail's width as state, read from storage on mount and written back on change. */
export function useNotesRailWidth(): RailWidth {
  return useRailWidth(NOTES_RAIL)
}
