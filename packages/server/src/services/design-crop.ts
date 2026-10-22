import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { designCropsDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { writeToLiveTerminal } from '../launcher/launcher'
import { activeSessionsForFeature } from '../launcher/sessions'
import { emit } from './events'
import { getFeatureRow } from './repo'

/**
 * Select area in the design view (design-mode decision 4, spec "The design
 * loop" step 5): the crop is a request to the agent, not a finding for review.
 * The PNG is saved under the data dir — never the repo the chat commits from —
 * and its path, with the human's words, is typed into the feature's live chat
 * as `[Screenshot: <path>] <text>`, the shape the design guide tells the agent
 * to expect.
 */

/** Thrown when there is no live feature chat to type the crop into; the web toasts it. */
export const NO_LIVE_CHAT = 'the chat is not running — open it, then select again'

/** The one line the chat receives: newlines flattened, since a newline would submit early. */
export function cropMessage(path: string, text: string): string {
  return `[Screenshot: ${path}] ${text.replace(/\s*[\r\n]+\s*/g, ' ').trim()}`.trimEnd()
}

export function sendDesignCrop(ctx: AppCtx, featureId: string, png: Buffer, text: string): { path: string } {
  getFeatureRow(ctx, featureId)
  const chat = activeSessionsForFeature(ctx, featureId).find((s) => s.kind === 'chat' && !s.headless)
  if (!chat) throw new GateError(NO_LIVE_CHAT)

  const dir = designCropsDir(featureId)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${Date.now()}.png`)
  writeFileSync(path, png)

  if (!writeToLiveTerminal(chat.id, cropMessage(path, text))) throw new GateError(NO_LIVE_CHAT)
  emit(ctx, featureId, {
    type: 'design.crop_sent',
    message: 'design crop sent to the chat',
    data: { path },
  })
  return { path }
}
