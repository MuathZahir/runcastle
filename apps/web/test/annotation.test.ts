import { describe, expect, it } from 'vitest'
import { arrowHead, beginShape, canSave, clear, commitShape, emptyAnnotation, extendShape, isDirty, rectFrom, redo, setText, setTool, undo } from '../src/lib/annotation'

describe('annotation stroke model', () => {
  it('records many sequential shapes without a DOM', () => {
    let state = emptyAnnotation()
    for (let i = 0; i < 100; i++) state = commitShape(extendShape(beginShape(state, { x: i, y: i }), { x: i + 1, y: i + 2 }))
    expect(state.shapes).toHaveLength(100)
    expect(globalThis.document).toBeUndefined()
  })
  it('undoes, redoes, clears, and changes tools immutably', () => {
    const drawn = commitShape(extendShape(beginShape(setTool(emptyAnnotation(), 'arrow'), { x: 0, y: 0 }), { x: 2, y: 2 }))
    expect(redo(undo(drawn))).toEqual(drawn)
    expect(clear(drawn).shapes).toEqual([])
  })
  it('keeps a one-point pen mark as saveable content', () => {
    expect(canSave(commitShape(beginShape(emptyAnnotation(), { x: 2, y: 3 })))).toBe(true)
  })
  it.each([[emptyAnnotation(), false], [setText(emptyAnnotation(), '  '), false], [setText(emptyAnnotation(), 'note'), true], [commitShape(extendShape(beginShape(emptyAnnotation(), { x: 0, y: 0 }), { x: 1, y: 1 })), true]] as const)('derives save and dirty state', (state, expected) => {
    expect(canSave(state)).toBe(expected); expect(isDirty(state)).toBe(expected)
  })
  it('derives rectangle and arrow geometry', () => {
    expect(rectFrom({ x: 8, y: 9 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 3, width: 6, height: 6 })
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)
    expect(a.x).toBeCloseTo(b.x); expect(a.y).toBeCloseTo(-b.y)
  })
})
