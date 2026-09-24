import type { ProjectNote } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import { driveTag, projectDriveCard, splitDriveNotes } from '../src/lib/project-drive'

/**
 * The project drive's pure derivations (project-level-test-drive decisions 4,
 * 5, 7, 9): what the Test drive card offers, how the rail splits the inbox
 * around the live drive, and the tag a drive note wears.
 */

const base = {
  empty: false,
  setupCommand: 'bun run drive:setup',
  devCommand: 'bun run dev',
  drive: null,
  projectId: 'proj_1',
}

const projectDrive = {
  projectDrive: true as const,
  projectId: 'proj_1',
  holderLabel: 'a project drive of main',
}

describe('projectDriveCard', () => {
  it('is hidden on an empty project', () => {
    expect(projectDriveCard({ ...base, empty: true })).toEqual({ state: 'hidden' })
  })

  it('offers preparation when neither a setup nor a dev command is set', () => {
    expect(projectDriveCard({ ...base, setupCommand: undefined, devCommand: '  ' })).toEqual({
      state: 'prepare',
    })
  })

  it('drives with only one of the two set', () => {
    expect(projectDriveCard({ ...base, devCommand: undefined })).toEqual({ state: 'ready' })
    expect(projectDriveCard({ ...base, setupCommand: undefined })).toEqual({ state: 'ready' })
  })

  it('is blocked by another drive, named by its holder label', () => {
    const feature = { featureId: 'feat_1', holderLabel: 'a test drive of feature/x' }
    expect(projectDriveCard({ ...base, drive: feature })).toEqual({
      state: 'blocked',
      reason: 'a test drive of feature/x is running',
    })
    const other = { ...projectDrive, projectId: 'proj_2' }
    expect(projectDriveCard({ ...base, drive: other })).toEqual({
      state: 'blocked',
      reason: 'a project drive of main is running',
    })
  })

  it("is running while this project's drive holds the slot", () => {
    expect(projectDriveCard({ ...base, drive: projectDrive })).toEqual({ state: 'running' })
  })

  it('is ready otherwise', () => {
    expect(projectDriveCard(base)).toEqual({ state: 'ready' })
  })
})

const note = (id: string, createdAt: number, over: Partial<ProjectNote> = {}): ProjectNote => ({
  id,
  projectId: 'proj_1',
  text: id,
  status: 'open',
  createdAt,
  updatedAt: createdAt,
  ...over,
})

describe('splitDriveNotes', () => {
  const notes = [
    note('before', 100),
    note('during', 300),
    note('at-start', 200),
    note('triaged', 400, { status: 'triaged' }),
  ]

  it("puts this drive's open notes first and the rest below, newest first", () => {
    const split = splitDriveNotes(notes, 200)
    expect(split.thisDrive.map((n) => n.id)).toEqual(['during', 'at-start'])
    expect(split.alreadyOpen.map((n) => n.id)).toEqual(['before'])
  })

  it('has no "this drive" group without a drive', () => {
    const split = splitDriveNotes(notes, undefined)
    expect(split.thisDrive).toEqual([])
    expect(split.alreadyOpen.map((n) => n.id)).toEqual(['during', 'at-start', 'before'])
  })
})

describe('driveTag', () => {
  it('names the branch, with the commit on hover', () => {
    expect(driveTag({ driveBranch: 'main', driveCommit: '1882e87' })).toEqual({
      label: 'drive · main',
      title: 'noted while driving main @ 1882e87',
    })
  })

  it('is absent on a note taken outside a drive', () => {
    expect(driveTag({})).toBeNull()
  })
})
