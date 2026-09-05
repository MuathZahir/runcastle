import type { Point } from './walkthrough'

export type Tool = 'pen' | 'arrow' | 'rect'
export interface Shape { tool: Tool; points: Point[] }
export interface AnnotationState { tool: Tool; shapes: Shape[]; redo: Shape[]; text: string }

export const emptyAnnotation = (tool: Tool = 'pen'): AnnotationState => ({ tool, shapes: [], redo: [], text: '' })

export function beginShape(state: AnnotationState, point: Point): AnnotationState {
  return { ...state, shapes: [...state.shapes, { tool: state.tool, points: [point] }], redo: [] }
}

export function extendShape(state: AnnotationState, point: Point): AnnotationState {
  if (state.shapes.length === 0) return state
  const shapes = state.shapes.slice()
  const current = shapes[shapes.length - 1]!
  shapes[shapes.length - 1] = { ...current, points: [...current.points, point] }
  return { ...state, shapes }
}

export function commitShape(state: AnnotationState): AnnotationState {
  // A shape is accumulated directly in `shapes`; committing is deliberately a
  // pure boundary marker. A one-point pen shape is a valid dot, not an empty
  // gesture to discard.
  return state
}

export function undo(state: AnnotationState): AnnotationState {
  const shape = state.shapes.at(-1)
  return shape ? { ...state, shapes: state.shapes.slice(0, -1), redo: [...state.redo, shape] } : state
}

export function redo(state: AnnotationState): AnnotationState {
  const shape = state.redo.at(-1)
  return shape ? { ...state, shapes: [...state.shapes, shape], redo: state.redo.slice(0, -1) } : state
}

export const clear = (state: AnnotationState): AnnotationState => ({ ...state, shapes: [], redo: [] })
export const setTool = (state: AnnotationState, tool: Tool): AnnotationState => ({ ...state, tool })
export const setText = (state: AnnotationState, text: string): AnnotationState => ({ ...state, text })
export const canSave = (state: AnnotationState): boolean => state.shapes.length > 0 || state.text.trim().length > 0
export const isDirty = canSave

export function rectFrom(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

export function arrowHead(from: Point, to: Point, size: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  return [
    { x: to.x - size * Math.cos(angle - Math.PI / 6), y: to.y - size * Math.sin(angle - Math.PI / 6) },
    { x: to.x - size * Math.cos(angle + Math.PI / 6), y: to.y - size * Math.sin(angle + Math.PI / 6) },
  ]
}
