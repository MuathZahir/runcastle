import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, statSync, type WriteStream } from 'node:fs'
import { once } from 'node:events'
import { createGzip, type Gzip } from 'node:zlib'
import type { PackedFile } from './types'

/**
 * A streaming `.tar.gz` writer. Files go straight from where they sit into the
 * pack, so a move never needs a second copy of gigabytes on the old machine's
 * disk, and never hits Windows path limits in a staging folder. System `tar`
 * reads the result on the other side.
 */

const BLOCK = 512
/** The largest size a ustar header can hold in its 11 octal digits. */
const USTAR_MAX_SIZE = 0o77777777777

function writeField(block: Buffer, offset: number, length: number, value: string): void {
  block.write(value.slice(0, length), offset, length, 'utf8')
}

function octal(value: number, digits: number): string {
  return `${Math.trunc(value).toString(8).padStart(digits, '0')}\0`
}

function header(name: string, size: number, mtimeSeconds: number, type: '0' | 'x'): Buffer {
  const block = Buffer.alloc(BLOCK)
  writeField(block, 0, 100, name)
  writeField(block, 100, 8, octal(type === 'x' ? 0o644 : 0o600, 7))
  writeField(block, 108, 8, octal(0, 7))
  writeField(block, 116, 8, octal(0, 7))
  writeField(block, 124, 12, octal(Math.min(size, USTAR_MAX_SIZE), 11))
  writeField(block, 136, 12, octal(mtimeSeconds, 11))
  block.fill(' ', 148, 156)
  writeField(block, 156, 1, type)
  writeField(block, 257, 8, 'ustar\x0000')
  const sum = block.reduce((total, byte) => total + byte, 0)
  writeField(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `)
  return block
}

/** One pax record: its own length in decimal comes first, and counts itself. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`
  const bodyBytes = Buffer.byteLength(body)
  let length = bodyBytes + 1
  while (String(length).length + bodyBytes !== length) length = String(length).length + bodyBytes
  return `${length}${body}`
}

function needsPaxName(name: string): boolean {
  return name.length > 100 || Buffer.byteLength(name) !== name.length
}

export class TarWriter {
  private readonly gzip: Gzip
  private readonly out: WriteStream
  private failure: Error | undefined
  private paxCount = 0
  readonly files: PackedFile[] = []

  constructor(path: string) {
    this.gzip = createGzip({ level: 6 })
    this.out = createWriteStream(path, { mode: 0o600 })
    // A full disk fails the file stream, and nothing then drains the gzip stream,
    // so a failure on either side has to wake whoever waits on the gzip one.
    const fail = (err: Error): void => {
      this.failure ??= err
      this.gzip.destroy(err)
    }
    this.gzip.on('error', fail)
    this.out.on('error', fail)
    this.gzip.pipe(this.out)
  }

  private async write(chunk: Buffer): Promise<void> {
    if (this.failure) throw this.failure
    if (!this.gzip.write(chunk)) await once(this.gzip, 'drain')
  }

  private async writeHeaders(name: string, size: number, mtimeSeconds: number): Promise<void> {
    const records =
      (needsPaxName(name) ? paxRecord('path', name) : '') +
      (size > USTAR_MAX_SIZE ? paxRecord('size', String(size)) : '')
    if (records) {
      const body = Buffer.from(records, 'utf8')
      await this.write(header(`PaxHeader/${this.paxCount++}`, body.length, mtimeSeconds, 'x'))
      await this.write(body)
      await this.pad(body.length)
    }
    await this.write(header(needsPaxName(name) ? `long/${this.paxCount}` : name, size, mtimeSeconds, '0'))
  }

  private async pad(size: number): Promise<void> {
    const over = size % BLOCK
    if (over) await this.write(Buffer.alloc(BLOCK - over))
  }

  /** Add a file from disk under `name`. It must not change while it is read. */
  async addFile(name: string, path: string): Promise<void> {
    const stat = statSync(path)
    await this.writeHeaders(name, stat.size, stat.mtimeMs / 1000)
    const hash = createHash('sha256')
    let read = 0
    for await (const chunk of createReadStream(path)) {
      const buffer = chunk as Buffer
      read += buffer.length
      hash.update(buffer)
      await this.write(buffer)
    }
    if (read !== stat.size) throw new Error(`${path} changed while it was being packed`)
    await this.pad(read)
    this.files.push({ path: name, size: read, sha256: hash.digest('hex') })
  }

  /** Add bytes held in memory. Not listed in {@link files}: only the manifest uses this. */
  async addBuffer(name: string, body: Buffer): Promise<void> {
    await this.writeHeaders(name, body.length, Date.now() / 1000)
    await this.write(body)
    await this.pad(body.length)
  }

  /** Give up: release the output file so it can be removed. */
  abort(): void {
    this.gzip.destroy()
    this.out.destroy()
  }

  async finish(): Promise<void> {
    await this.write(Buffer.alloc(BLOCK * 2))
    this.gzip.end()
    if (!this.out.closed) await once(this.out, 'close')
    if (this.failure) throw this.failure
  }
}

/** The sha256 of a file on disk. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
