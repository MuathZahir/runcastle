import { NotImplementedError } from '../errors'

/** `runcastle setup`: list what this machine is missing and install it. Returns the exit code. */
export async function runSetup(_argv: string[]): Promise<number> {
  throw new NotImplementedError('one-line-install: runcastle setup')
}
