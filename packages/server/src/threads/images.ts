import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newId, type Attachment } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import { GateError } from '../errors'
import type { PromptImage } from './types'

/**
 * The images sent with a thread's prompts, kept beside its log
 * (`<sessionDir>/images/<id>.<ext>`) and served by `routes/threads.ts`. The log
 * holds the URL, never the bytes, so reading a thread stays cheap.
 */

/** The image types a prompt may carry, by the extension they are stored under. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const EXTENSIONS = new Map(Object.entries(IMAGE_TYPES).map(([ext, mime]) => [mime, ext]))

/** A stored image's file name: an id this server minted and a known extension, nothing else. */
const IMAGE_FILE = /^[A-Za-z0-9_-]+\.(png|jpg|gif|webp)$/
const THREAD_ID = /^[A-Za-z0-9_-]+$/

/** Where a thread's image is served from. */
export function threadImageUrl(threadId: string, file: string): string {
  return `/api/threads/${threadId}/images/${file}`
}

/** The stored image `file` of a thread, or null for a name this store never writes. */
export function threadImagePath(threadId: string, file: string): string | null {
  if (!THREAD_ID.test(threadId) || !IMAGE_FILE.test(file)) return null
  return join(sessionDir(threadId), 'images', file)
}

/** Store one sent image and return the attachment the prompt event carries. */
export function saveThreadImage(threadId: string, image: PromptImage): Attachment {
  const ext = EXTENSIONS.get(image.mimeType)
  if (!ext) throw new GateError(`a ${image.mimeType} image cannot be sent; send a PNG, JPEG, GIF or WebP`)
  const file = `${newId('img')}.${ext}`
  const dir = join(sessionDir(threadId), 'images')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), Buffer.from(image.data, 'base64'))
  return { id: file.slice(0, -ext.length - 1), src: threadImageUrl(threadId, file), name: image.name }
}
