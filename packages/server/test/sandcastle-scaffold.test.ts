import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ASSET_ENV } from '../src/launcher/asset-paths'
import { sandcastleTemplateDir, scaffoldSandcastleConfig } from '../src/services/setup'

/**
 * Issue #50 — clicking "Build image" must never dead-end on sandcastle's
 * `No .sandcastle/ found` error on a fresh install. runcastle ships a vetted
 * burner template as a package asset and scaffolds a `.sandcastle/` build context
 * from it on demand — create-only, so a hand-tuned config is never clobbered.
 */

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'runcastle-scaffold-'))
}

afterEach(() => {
  delete process.env[ASSET_ENV.sandcastleTemplate]
})

describe('sandcastleTemplateDir', () => {
  it('resolves to a real dir shipping both a Containerfile and a Dockerfile', () => {
    const dir = sandcastleTemplateDir()
    expect(existsSync(join(dir, 'Containerfile'))).toBe(true)
    expect(existsSync(join(dir, 'Dockerfile'))).toBe(true)
  })

  it('ships a Containerfile that honours the rootless UID/GID 1000 invariant', () => {
    const containerfile = readFileSync(join(sandcastleTemplateDir(), 'Containerfile'), 'utf8')
    // The agent user must land at 1000/1000 (research #32) and the user must exist.
    expect(containerfile).toMatch(/AGENT_UID=1000/)
    expect(containerfile).toMatch(/AGENT_GID=1000/)
    expect(containerfile).toMatch(/usermod[^\n]*agent/)
  })

  // One image serves both runtimes — a burn picks its CLI from the resolved
  // model's runtime, so a codex-runtime ticket must find `codex` in the same
  // image a claude one finds `claude`.
  it.each(['Containerfile', 'Dockerfile'])('installs both agent CLIs in the %s', (file) => {
    const image = readFileSync(join(sandcastleTemplateDir(), file), 'utf8')
    expect(image).toMatch(/claude\.ai\/install\.sh/)
    expect(image).toMatch(/npm install -g @openai\/codex/)
    // The codex install must precede the USER switch: a global npm install has
    // nowhere writable to go once the build drops to the unprivileged agent.
    expect(image.indexOf('@openai/codex')).toBeLessThan(image.indexOf('USER ${AGENT_UID}'))
  })
})

describe('scaffoldSandcastleConfig', () => {
  it('copies every template file into a fresh `.sandcastle/` and reports scaffolded', () => {
    const template = tmp()
    writeFileSync(join(template, 'Containerfile'), 'FROM node:22\n')
    writeFileSync(join(template, 'Dockerfile'), 'FROM node:22\n')
    const target = tmp()

    const res = scaffoldSandcastleConfig(template, target)

    expect(res.scaffolded).toBe(true)
    expect(res.dir).toBe(join(target, '.sandcastle'))
    expect(readdirSync(res.dir).sort()).toEqual(['Containerfile', 'Dockerfile'])
    expect(readFileSync(join(res.dir, 'Containerfile'), 'utf8')).toBe('FROM node:22\n')
  })

  it('never overwrites an existing `.sandcastle/` (a hand-tuned config is preserved)', () => {
    const template = tmp()
    writeFileSync(join(template, 'Containerfile'), 'FROM template\n')
    const target = tmp()
    const existing = join(target, '.sandcastle')
    mkdirSync(existing, { recursive: true })
    writeFileSync(join(existing, 'Containerfile'), 'FROM hand-tuned\n')

    const res = scaffoldSandcastleConfig(template, target)

    expect(res.scaffolded).toBe(false)
    expect(readFileSync(join(existing, 'Containerfile'), 'utf8')).toBe('FROM hand-tuned\n')
  })

  it('is idempotent — a second call is a no-op once the context exists', () => {
    const template = tmp()
    writeFileSync(join(template, 'Containerfile'), 'FROM node:22\n')
    const target = tmp()

    expect(scaffoldSandcastleConfig(template, target).scaffolded).toBe(true)
    expect(scaffoldSandcastleConfig(template, target).scaffolded).toBe(false)
  })
})
