import { NotImplementedError } from '../errors'

/** `runcastle service install|remove`: keep runcastle running on Linux. Returns the exit code. */
export async function runService(_argv: string[]): Promise<number> {
  throw new NotImplementedError('one-line-install: runcastle service')
}
