import { NotImplementedError } from '../errors'

/**
 * Standalone hook client — WAVE B1 (SPEC §5.5). Runs INSIDE a Claude Code
 * session (`bun run hook-client.ts <event>`): reads the hook JSON from stdin,
 * POSTs `{ event, env, payload }` to `RUNCASTLE_SERVER_URL/api/hooks/<event>`,
 * prints the server response verbatim, exit 0. Typed stub: signature is final
 * so B1 replaces only the body.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  void argv
  throw new NotImplementedError('B1')
}

if (import.meta.main) {
  main().catch((err) => {
    // Never break the user's session: log, print `{}`, exit 0 (SPEC §5.5).
    console.error(err)
    console.log('{}')
    process.exit(0)
  })
}
