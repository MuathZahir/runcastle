import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  prepareReviewArtifactsDirectory,
  prepareReviewDirectory,
  type ReviewDirectoryFs,
} from '../src/workflows/review-ticket'

describe('review directory preparation', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  })

  function tempReviewDir(): string {
    const parent = mkdtempSync(join(tmpdir(), 'runcastle-review-prep-'))
    tempDirs.push(parent)
    return join(parent, 'ticket-7')
  }

  it('reaps the derived ticket session before touching the review directory', async () => {
    const operations: string[] = []
    const fs: ReviewDirectoryFs = {
      readDir: () => { operations.push('read-dir'); return [] },
      remove: () => operations.push('remove'),
      rename: vi.fn(),
      mkdir: () => operations.push('mkdir'),
    }
    const recorderReap = vi.fn(async (ticketId: string) => {
      operations.push(`reap:${ticketId}`)
      return { confirmed: true }
    })

    await prepareReviewArtifactsDirectory('ticket-7', '/reviews/ticket-7', { fs, recorderReap })

    expect(operations).toEqual(['reap:ticket-7', 'read-dir', 'remove', 'mkdir'])
  })

  it('wipes prior outcome files and recreates an empty review directory', () => {
    const dir = tempReviewDir()
    mkdirSync(dir)
    writeFileSync(join(dir, 'DIGEST.md'), 'stale success')
    writeFileSync(join(dir, 'BLOCKED.md'), 'stale failure')

    prepareReviewDirectory(dir)

    expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(dir, 'DIGEST.md'))).toBe(false)
    expect(existsSync(join(dir, 'BLOCKED.md'))).toBe(false)
  })

  it('renames a directory aside when its wipe fails, then creates a fresh directory', () => {
    const operations: string[] = []
    const fs: ReviewDirectoryFs = {
      readDir: () => [],
      remove: (path) => {
        operations.push(`remove:${path}`)
        throw new Error('EBUSY')
      },
      rename: (from, to) => operations.push(`rename:${from}:${to}`),
      mkdir: (path) => operations.push(`mkdir:${path}`),
    }

    prepareReviewDirectory('C:\\reviews\\ticket-7', { now: () => 1_234, fs })

    expect(operations).toEqual([
      'remove:C:\\reviews\\ticket-7',
      'rename:C:\\reviews\\ticket-7:C:\\reviews\\ticket-7.stale-1234',
      'mkdir:C:\\reviews\\ticket-7',
    ])
  })

  it('best-effort collects only this ticket\'s stale siblings', () => {
    const removed: string[] = []
    const fs: ReviewDirectoryFs = {
      readDir: () => ['ticket-7.stale-100', 'ticket-8.stale-100', 'ticket-7.stale-200'],
      remove: (path) => {
        removed.push(path)
        if (path.endsWith('stale-100')) throw new Error('still locked')
      },
      rename: vi.fn(),
      mkdir: vi.fn(),
    }

    expect(() => prepareReviewDirectory('/reviews/ticket-7', { fs })).not.toThrow()
    expect(removed).toEqual([
      '/reviews/ticket-7.stale-100',
      '/reviews/ticket-7.stale-200',
      '/reviews/ticket-7',
    ])
  })

  it('explains the held-open cause and manual remedy when rename also fails', () => {
    const fs: ReviewDirectoryFs = {
      readDir: () => [],
      remove: () => { throw new Error('EBUSY') },
      rename: () => { throw new Error('EPERM') },
      mkdir: vi.fn(),
    }

    expect(() => prepareReviewDirectory('/reviews/ticket-7', { fs })).toThrow(
      /held open by another process.*taskkill \/PID <pid> \/T \/F/s,
    )
    expect(fs.mkdir).not.toHaveBeenCalled()
  })
})
