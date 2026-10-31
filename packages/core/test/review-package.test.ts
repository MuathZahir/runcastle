import { describe, expect, it } from 'vitest'
import { foldThread, maskedCall, noPicturesLine, orderedFindings, packageGroups, reviewShotUrl, type SawEntry, type ThreadEvent } from '../src'

const landed = (file: string, name: string): SawEntry => ({ kind: 'scenario', at: 1, file, name, ok: true, entryUrl: '/x' })
const shot = (image: string, scenario?: string): SawEntry => ({ kind: 'shot', at: 2, caption: image, image, ...(scenario ? { scenario } : {}) })

describe('packageGroups', () => {
  it('groups pictures and calls by scenario, and puts the rest in Other checks', () => {
    const groups = packageGroups('t1', [
      landed('a.ts', 'A note'),
      shot('shot-1.png', 'a.ts'),
      {
        kind: 'call',
        at: 3,
        scenario: 'a.ts',
        request: { method: 'GET', url: '/ping', headers: [] },
        result: { ok: false, error: 'refused' },
      },
      shot('shot-2.png'),
    ])
    expect(groups.map((g) => g.name)).toEqual(['A note', 'Other checks'])
    expect(groups[0]?.shots[0]?.src).toBe(reviewShotUrl('t1', 'shot-1.png'))
    expect(groups[0]?.calls[0]).toMatchObject({ method: 'GET', url: '/ping' })
    expect(groups[1]?.shots).toHaveLength(1)
  })

  it('needs no heading for a pass that ran no scenario', () => {
    expect(packageGroups('t1', [shot('shot-1.png')]).map((g) => g.name)).toEqual([null])
  })

  it('says why a scenario did not land, and forgets it once a later run lands', () => {
    const failed: SawEntry = {
      kind: 'scenario',
      at: 1,
      file: 'a.ts',
      name: 'A note',
      ok: false,
      failure: { reason: 'exit', exitCode: 2, outputTail: 'boot\nno such table' },
    }
    expect(packageGroups('t1', [failed])[0]?.failure).toBe('it exited 2: no such table')
    expect(packageGroups('t1', [failed, landed('a.ts', 'A note')])[0]?.failure).toBeUndefined()
  })
})

describe('maskedCall', () => {
  it('masks credential headers on both sides, whatever their case, and keeps the rest', () => {
    const { request, result } = maskedCall(
      { method: 'POST', url: '/x', headers: [['Authorization', 'Bearer tok'], ['Accept', 'json']], body: 'b' },
      { ok: true, status: 200, statusText: 'OK', durationMs: 1, headers: [['Set-Cookie', 'sid=1']], body: 'b', truncated: false },
    )
    expect(request.headers).toEqual([['Authorization', '•••'], ['Accept', 'json']])
    expect(request.body).toBe('b')
    expect(result).toMatchObject({ headers: [['Set-Cookie', '•••']] })
  })
})

describe('what the page reads', () => {
  it('puts defects first, worst first', () => {
    const ordered = orderedFindings([
      { kind: 'observation', severity: 'high' },
      { kind: 'defect', severity: 'low' },
      { kind: 'defect', severity: 'high' },
    ] as const)
    expect(ordered.map((f) => `${f.kind} ${f.severity}`)).toEqual(['defect high', 'defect low', 'observation high'])
  })

  it('says why a pass has no pictures', () => {
    expect(noPicturesLine('gates', false)).toContain('read the code')
    expect(noPicturesLine('drive', false)).toBe('The review took no screenshots.')
    expect(noPicturesLine('drive', true)).toContain('stopped')
  })
})

describe('a review package in a thread', () => {
  const event = (i: number, body: Record<string, unknown>) => ({ i, at: i, ...body }) as unknown as ThreadEvent

  it('stands alone with no turn open', () => {
    const view = foldThread([event(0, { type: 'review_package', ticketId: 't1' })])
    expect(view.items).toEqual([{ kind: 'review_package', id: 'review_package:0', ticketId: 't1' }])
  })
})
