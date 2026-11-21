import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

/** The live (not zombie) processes whose command line contains `needle`, by pid. */
export function processesWith(needle: string): number[] {
  if (process.platform === 'linux') {
    const pids: number[] = []
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
        const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
        if (state === 'Z' || state === 'X') continue
        if (readFileSync(`/proc/${name}/cmdline`, 'utf8').includes(needle)) pids.push(Number(name))
      } catch {
        // Gone since the listing.
      }
    }
    return pids
  }
  const out = execFileSync('ps', ['-ww', '-A', '-o', 'pid=,stat=,command='], { encoding: 'utf8' })
  return out
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m && !m[2]!.startsWith('Z') && m[3]!.includes(needle))
    .map((m) => Number(m[1]))
}

/** Wait until `done()` holds, polling; throws with `what` when `ms` runs out. */
export async function until(done: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}
