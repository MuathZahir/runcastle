import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The root README is the only surface a stranger reads before their first
 * session (issue #52). These assertions pin the acceptance criteria: a nothing→
 * first-session path, cleanly separated user vs. contributor sections, an honest
 * Docker licensing callout that links (not hardcodes) the pricing, a documented
 * Podman path, and none of the old status/dev-log content. They intentionally
 * check *content contracts*, not prose, so the README can be reworded freely.
 */
const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'README.md'),
  'utf8',
)

describe('README for strangers', () => {
  it('gives the global install and boot commands', () => {
    expect(README).toContain('bun add -g runcastle')
    expect(README).toContain('runcastle doctor')
    expect(README).toMatch(/http:\/\/localhost:4512/)
  })

  it('documents prerequisites, and Node is not one of them', () => {
    expect(README).toMatch(/prerequisit/i)
    expect(README).not.toContain('nodejs.org')
    // A paid Claude plan is required — the free plan has no Claude Code access.
    expect(README).toMatch(/free[^\n]*Claude[^\n]*(no|not)|Claude Code access|paid Claude plan/i)
  })

  it('walks a stranger through the first run', () => {
    expect(README).toMatch(/first[- ]run/i)
    expect(README).toMatch(/git identity/i)
  })

  it('separates user install from contributor setup', () => {
    expect(README).toMatch(/^##.*install/im)
    expect(README).toMatch(/^##.*contribut/im)
    // The contributor path clones and runs from source.
    expect(README).toMatch(/git clone/i)
    expect(README).toContain('bun run dev')
  })

  it('has an unmissable Docker Desktop licensing callout that links pricing without hardcoding numbers', () => {
    expect(README).toMatch(/docker desktop/i)
    expect(README).toMatch(/licens/i)
    expect(README).toMatch(/docker\.com\/pricing/i)
    // Link the pricing page; never hardcode the thresholds (they have moved twice).
    expect(README).not.toMatch(/250 employees/i)
    expect(README).not.toMatch(/\$10 ?M|10 million/i)
  })

  it('documents the Podman alternative and the Windows floor', () => {
    expect(README).toMatch(/podman/i)
    // Windows Docker floor: 10 22H2 + WSL2/Hyper-V.
    expect(README).toMatch(/22H2/)
    expect(README).toMatch(/WSL2|Hyper-V/i)
  })

  it('covers the troubleshooting notes the setup path can hit', () => {
    expect(README).toMatch(/WSL[^\n]*bind[- ]?mount|bind[- ]?mount[^\n]*WSL/i)
    expect(README).toMatch(/embedded terminal will not start/i)
  })

  // The audience greps a new tool for phone-home code. The README has to name
  // the endpoint, the whole payload, and the opt-out before they find it.
  it('discloses the usage signal payload and the DO_NOT_TRACK opt-out', () => {
    expect(README).toMatch(/usage signal/i)
    expect(README).toContain('https://ping.runcastle.dev/ping')
    expect(README).toContain('installId')
    expect(README).toContain('platform')
    expect(README).toContain('~/.runcastle/install-id')
    expect(README).toContain('DO_NOT_TRACK')
  })

  it('tells the loop in the four stages the app shows', () => {
    for (const stage of ['Planning', 'Build', 'Review', 'Shipped']) {
      expect(README).toContain(`**${stage}**`)
    }
    expect(README).not.toMatch(/six phases|ideation/i)
  })

  it('lists prerequisites in two tiers: to run, and before the first round', () => {
    expect(README).toMatch(/to run runcastle/i)
    expect(README).toMatch(/before your first round/i)
  })

  it('says the server only prints its address', () => {
    expect(README).toMatch(/does not open a browser/i)
  })

  it('documents running on another machine with both ports, and the phone link', () => {
    expect(README).toMatch(/^##\s+On another machine/m)
    expect(README).toContain('ssh -L 4512:localhost:4512 -L 4514:localhost:4514 user@host')
    expect(README).toContain('https://runcastle.dev/docs/vps/')
    expect(README).toMatch(/^##\s+On your phone/m)
    expect(README).toMatch(/home[- ]screen/i)
  })

  it('names the usage ping beside install and the Settings switch', () => {
    expect(README).toMatch(/Settings → General/)
    expect(README).toMatch(/first-run wizard/i)
  })

  it('points bug reports at GitHub Issues', () => {
    expect(README).toContain('https://github.com/MuathZahir/runcastle/issues')
  })

  it('uses one word per concept: no retired names', () => {
    expect(README).not.toMatch(/burn|\bAFK\b|\blaps?\b|\blanes?\b|drive mode|project session|\bthreads?\b/i)
  })

  it('has dropped the old status / dev-log content', () => {
    expect(README).not.toMatch(/smoke-passing/i)
    expect(README).not.toMatch(/109 tests/i)
    expect(README).not.toMatch(/all waves landed/i)
  })
})
