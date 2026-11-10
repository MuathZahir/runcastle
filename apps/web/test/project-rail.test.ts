import { describe, expect, it } from 'vitest'
import { initialsOf, moveInList, railShortcutIndex, railTiles, type RailShortcutEvent } from '../src/lib/project-rail'
import type { Project } from '../src/lib/api'
import { listItem, need } from './fixtures'

/**
 * The project rail's pure half (a-better-way-to-move-between-projects): the
 * tiles, the drag's move, and the Alt+digit shortcut.
 */

const project = (id: string, name: string, position = 0): Project => ({ id, name, repoPath: `/code/${name}`, position })

describe('initialsOf', () => {
  it.each([
    ['runcastle', 'R'],
    ['runcastle-demo', 'RD'],
    ['terminal-wait-game', 'TW'],
    ['JanaLearn_Updated', 'JL'],
    ['clawflow', 'C'],
    ['jev-browser-extension', 'JB'],
    ['jewellery-system', 'JS'],
    ['my project', 'MP'],
    ['camelCase', 'CC'],
  ])('%s → %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials)
  })
})

describe('railTiles', () => {
  const projects = [
    project('p1', 'runcastle'),
    project('p2', 'clawflow'),
    project('p3', 'JanaLearn_Updated'),
  ]
  const waiting = listItem({ need: need('plan', 'Plan to approve') })
  const quiet = listItem({ id: 'feat_2' })

  it('keeps the given order and names each tile', () => {
    const tiles = railTiles(projects, [[], [], []], 'p1')
    expect(tiles.map((t) => [t.id, t.name, t.initials])).toEqual([
      ['p1', 'runcastle', 'R'],
      ['p2', 'clawflow', 'C'],
      ['p3', 'JanaLearn_Updated', 'JL'],
    ])
  })

  it('marks a project that needs you by the sidebar’s rule, never the current one', () => {
    const tiles = railTiles(projects, [[waiting], [quiet], [quiet, waiting]], 'p1')
    expect(tiles.map((t) => t.needsYou)).toEqual([false, false, true])
    // From All projects nothing is current, so the first one shows too.
    expect(railTiles(projects, [[waiting], [], []], null)[0]!.needsYou).toBe(true)
  })

  it('reads a list still loading as nothing waiting', () => {
    expect(railTiles(projects, [undefined, undefined], null).map((t) => t.needsYou)).toEqual([false, false, false])
  })

  it('numbers the first nine 1–9 and leaves the rest without a shortcut', () => {
    const many = Array.from({ length: 11 }, (_, i) => project(`p${i}`, `project-${i}`))
    expect(railTiles(many, [], null).map((t) => t.shortcut)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, null, null])
  })
})

describe('moveInList', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moves up', () => expect(moveInList(ids, 'c', 1)).toEqual(['a', 'c', 'b', 'd']))
  it('moves down', () => expect(moveInList(ids, 'b', 2)).toEqual(['a', 'c', 'b', 'd']))
  it('moves to the top', () => expect(moveInList(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c']))
  it('moves to the end', () => expect(moveInList(ids, 'a', 3)).toEqual(['b', 'c', 'd', 'a']))
  it('clamps past either end', () => {
    expect(moveInList(ids, 'b', 99)).toEqual(['a', 'c', 'd', 'b'])
    expect(moveInList(ids, 'c', -5)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('is a no-op in place or for an unknown id, and never mutates its input', () => {
    expect(moveInList(ids, 'b', 1)).toEqual(ids)
    expect(moveInList(ids, 'z', 0)).toEqual(ids)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('railShortcutIndex', () => {
  const key = (code: string, over: Partial<RailShortcutEvent> = {}): RailShortcutEvent => ({
    code,
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...over,
  })

  it('maps Alt+1…9 by physical key to 0…8', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => railShortcutIndex(key(`Digit${n}`)))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('ignores Alt+0, a bare digit, the numpad and other keys', () => {
    expect(railShortcutIndex(key('Digit0'))).toBeNull()
    expect(railShortcutIndex(key('Digit1', { altKey: false }))).toBeNull()
    expect(railShortcutIndex(key('Numpad1'))).toBeNull()
    expect(railShortcutIndex(key('KeyA'))).toBeNull()
  })

  it('leaves the chord alone with Ctrl, Meta or Shift held', () => {
    expect(railShortcutIndex(key('Digit1', { ctrlKey: true }))).toBeNull()
    expect(railShortcutIndex(key('Digit1', { metaKey: true }))).toBeNull()
    expect(railShortcutIndex(key('Digit1', { shiftKey: true }))).toBeNull()
  })
})
