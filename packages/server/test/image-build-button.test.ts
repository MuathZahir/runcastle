import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { tryImageBuildSlot } from '../src/services/image-build'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'

describe('the Build button while a burn is building', () => {
  let ctx: AppCtx
  let restoreDataDir: () => void

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
  })
  afterEach(() => restoreDataDir())

  it('refuses at once and says why', async () => {
    const release = tryImageBuildSlot()
    try {
      await expect(
        createCallerFactory(appRouter)(ctx).setup.startTerminal({ kind: 'build-image' }),
      ).rejects.toThrow('A burn is building the sandbox image right now')
    } finally {
      release?.()
    }
  })
})
