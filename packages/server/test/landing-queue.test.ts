import { describe, expect, it } from 'vitest'
import { createSerialQueue, featureLandingQueue } from '../src/services/landing-queue'

/**
 * The queue every merge onto `feature/<slug>` runs through. It used to be one
 * per run; `one-chat-per-feature` decision 2 widened it to one per FEATURE so a
 * chat's docs commit lands between ticket landings instead of racing them.
 */

describe('createSerialQueue — one task at a time, in order', () => {
  it('runs tasks strictly serially in submission order', async () => {
    const queue = createSerialQueue()
    const log: string[] = []
    let active = 0

    const task = (name: string, delay: number) => async () => {
      active += 1
      expect(active).toBe(1) // never overlaps
      log.push(`start ${name}`)
      await new Promise((r) => setTimeout(r, delay))
      log.push(`end ${name}`)
      active -= 1
      return name
    }

    // Submit concurrently; the slow first task must fully finish before the fast second starts.
    const [a, b, c] = await Promise.all([
      queue(task('a', 20)),
      queue(task('b', 1)),
      queue(task('c', 1)),
    ])

    expect([a, b, c]).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('a rejection reaches its submitter without wedging later tasks', async () => {
    const queue = createSerialQueue()

    const failing = queue(async () => {
      throw new Error('merge failed')
    })
    const after = queue(async () => 'still runs')

    await expect(failing).rejects.toThrow('merge failed')
    await expect(after).resolves.toBe('still runs')
  })
})

describe('featureLandingQueue — one serial order per feature', () => {
  it('serializes two independent callers on the same feature', async () => {
    const log: string[] = []
    const task = (name: string, delay: number) => async () => {
      log.push(`start ${name}`)
      await new Promise((r) => setTimeout(r, delay))
      log.push(`end ${name}`)
    }

    // The burner's landing loop and the chat's docs landing never see each
    // other; they only agree on the feature id.
    await Promise.all([
      featureLandingQueue('feat_shared')(task('ticket', 20)),
      featureLandingQueue('feat_shared')(task('chat', 1)),
    ])

    expect(log).toEqual(['start ticket', 'end ticket', 'start chat', 'end chat'])
  })

  it('does not serialize across features', async () => {
    let overlapped = false
    let active = 0
    const task = async () => {
      active += 1
      if (active > 1) overlapped = true
      await new Promise((r) => setTimeout(r, 10))
      active -= 1
    }

    await Promise.all([
      featureLandingQueue('feat_a')(task),
      featureLandingQueue('feat_b')(task),
    ])

    expect(overlapped).toBe(true)
  })
})
