import type { AgentStreamEvent } from '@ai-hero/sandcastle'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Feature, ModelEntry, Ticket } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUARD_RULES, buildGuardInstallCommand } from '../src/workflows/burn-guard'
import {
  CODEX_HOST_MOUNT_PATH,
  ISOLATED_REPO_PATH,
  SANDBOX_WORKSPACE_PATH,
  buildCodexAuthCopyCommand,
  buildConflictFilesBlock,
  buildDocsDigest,
  buildFeatureBrief,
  buildIsolatedSetupCommand,
  buildBurnAgent,
  buildOtherSideBlock,
  buildSandboxOptions,
  burnAuthReady,
  buildTicketJson,
  buildVerifyNotes,
  buildWorkspaceNotes,
  cacheMountFor,
  chainSetupCommands,
  codexAuthMountFor,
  composeRunDigest,
  harvestDigest,
  classifyTicketRunError,
  classifyToolCall,
  createToolTimer,
  formatTimingSummary,
  buildTicketTiming,
  emitTicketTiming,
  formatTicketTiming,
  createSerialQueue,
  createStreamThrottle,
  detectCycle,
  detectPackageManager,
  indexBySeq,
  interpretRunResult,
  isMergeConflictError,
  isWorktreeTeardownError,
  landWithResolve,
  parseEnvFile,
  readTokenFromEnvFile,
  renderTemplate,
  renderTicketPrompt,
  resolveBurnWorkspaceMode,
  resolveMergeCommand,
  resolveSetupCommand,
  resolveTicketModel,
  resolverTemplatePath,
  selectSandbox,
  burnerAssetPath,
  burnerTemplatePath,
  RUN_CONSTANT_PLACEHOLDERS,
  TICKET_SPECIFIC_PLACEHOLDERS,
  buildBlockersBlock,
  buildDriveNotes,
  buildFixNotes,
  buildGuardNotes,
  buildLapDigestsBlock,
  buildProjectStandards,
  readDocsDigest,
  trimMapDoc,
} from '../src/workflows/ticket-burner'
import type {
  HarvestedDigest,
  LandDeps,
  RepoToolchain,
  ResolveAttemptResult,
} from '../src/workflows/ticket-burner'
import type { TempBranchMergeResult } from '../src/services/git'
import { DEFAULT_SANDBOX_IMAGE, type RuncastleConfig } from '@runcastle/core'

function ticket(seq: number, blockedBy: number[] = [], overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: `tkt_${seq}`,
    featureId: 'feat_1',
    seq,
    title: `Ticket ${seq}`,
    goal: `goal ${seq}`,
    context: `context ${seq}`,
    acceptanceCriteria: [`criterion ${seq}`],
    seams: [`seam ${seq}`],
    blockedBy,
    status: 'pending',
    commits: [],
    ...overrides,
  }
}

const feature: Feature = {
  id: 'feat_1',
  projectId: 'proj_1',
  slug: 'my-feature',
  title: 'My Feature',
  oneLiner: 'does a thing',
  mapped: false,
  phase: 'implementation',
  branch: 'feature/my-feature',
  status: 'active',
  createdAt: 0,
}

function textEvent(message: string, iteration = 0): AgentStreamEvent {
  return { type: 'text', message, iteration, timestamp: new Date() }
}
function toolEvent(name: string, formattedArgs: string, iteration = 0): AgentStreamEvent {
  return { type: 'toolCall', name, formattedArgs, iteration, timestamp: new Date() }
}

describe('indexBySeq (seq→ticket resolution)', () => {
  it('resolves each global seq to its ticket, and blockers via the index', () => {
    const tickets = [ticket(1), ticket(2, [1]), ticket(3, [1, 2])]
    const bySeq = indexBySeq(tickets)
    expect(bySeq.get(2)?.id).toBe('tkt_2')
    expect(tickets[2].blockedBy.map((s) => bySeq.get(s)?.id)).toEqual(['tkt_1', 'tkt_2'])
    expect(bySeq.get(99)).toBeUndefined()
  })
})

describe('detectCycle', () => {
  it('returns null for an acyclic graph', () => {
    expect(detectCycle([ticket(1), ticket(2, [1]), ticket(3, [1, 2])])).toBeNull()
  })

  it('detects a 2-cycle', () => {
    const cycle = detectCycle([ticket(1, [2]), ticket(2, [1])])
    expect(cycle).not.toBeNull()
    expect(new Set(cycle)).toEqual(new Set([1, 2]))
  })

  it('detects a 3-cycle', () => {
    const cycle = detectCycle([ticket(1, [3]), ticket(2, [1]), ticket(3, [2])])
    expect(cycle).not.toBeNull()
    expect(new Set(cycle)).toEqual(new Set([1, 2, 3]))
  })

  it('ignores edges to seqs outside the ticket set', () => {
    expect(detectCycle([ticket(1, [99]), ticket(2, [1])])).toBeNull()
  })
})

/** Every implement-ticket placeholder, so a render leaves no stray `{{ }}`. */
function promptValues(
  overrides: Partial<Record<string, string>> = {},
): Record<
  (typeof RUN_CONSTANT_PLACEHOLDERS)[number] | (typeof TICKET_SPECIFIC_PLACEHOLDERS)[number],
  string
> {
  return {
    WORKSPACE_NOTES: buildWorkspaceNotes('isolated'),
    PROJECT_STANDARDS: 'standards go here',
    FEATURE_BRIEF: buildFeatureBrief(feature),
    DOCS_DIGEST: buildDocsDigest([{ name: 'spec.md', content: '# Spec\nbody' }]),
    VERIFY_NOTES: buildVerifyNotes({ verifyCommands: 'bun test' }),
    DRIVE_NOTES: 'drive notes go here',
    GUARD_NOTES: buildGuardNotes(true),
    TICKET_JSON: buildTicketJson(ticket(4)),
    BLOCKERS: buildBlockersBlock([], []),
    FIX_NOTES: buildFixNotes(ticket(4)),
    ...overrides,
  }
}

describe('renderTicketPrompt', () => {
  it('replaces every placeholder and leaves no stray {{ }}', () => {
    const out = renderTicketPrompt(readFileSync(burnerTemplatePath(), 'utf8'), promptValues())
    expect(out).not.toContain('{{')
    expect(out).not.toContain('}}')
    expect(out).toContain('"seq": 4')
    expect(out).toContain('My Feature')
    expect(out).toContain('feature/my-feature')
    expect(out).toContain('### spec.md')
    expect(out).toContain('bun test')
  })

  it('states the commit convention statically, keyed off the ticket JSON', () => {
    // COMMIT_CONVENTION used to be a per-ticket VALUE sitting above ~6.8 KB of
    // static tail, which broke the shared prefix twice per prompt for a string
    // the agent can read off the ticket itself.
    const template = readFileSync(burnerTemplatePath(), 'utf8')
    expect(template).not.toContain('{{COMMIT_CONVENTION}}')
    expect(template).toContain('ticket(<seq>): <summary>')
    expect(template).toMatch(/`seq` field of the ticket JSON/i)
  })

  it('makes the parent the only writer and bounds read-only subagent reports', () => {
    const out = renderTicketPrompt(readFileSync(burnerTemplatePath(), 'utf8'), promptValues())

    expect(out).toContain('You are the only writer in this tree.')
    expect(out).toContain('Subagents may READ and REPORT only — they never edit, never run tests.')
    expect(out).toContain(
      'Reports are ≤40 lines: file:line pointers plus one-sentence claims, zero source quotation.',
    )
    expect(out).toContain('Tell subagents what you already searched so they do not repeat it.')
  })

  it('carries the DIGEST.md contract into the prompt the burner actually gets', () => {
    const out = renderTicketPrompt(readFileSync(burnerTemplatePath(), 'utf8'), promptValues())

    expect(out).toContain('DIGEST.md')
    // The three-part template.
    expect(out).toMatch(/what was done/i)
    expect(out).toMatch(/surprises/i)
    expect(out).toMatch(/left undone/i)
    // Success-only, and never a repo artifact.
    expect(out).toMatch(/never commit `DIGEST.md`/i)
    expect(out).toMatch(/BLOCKED\.md[^.]*write no digest/i)
    // Written last — right before the completion signal.
    expect(out).toMatch(/before printing `<promise>COMPLETE<\/promise>`/)
    // The mode-specific location comes from the workspace notes.
    expect(out).toContain(`${SANDBOX_WORKSPACE_PATH}/DIGEST.md`)
  })

  it('gives BLOCKED.md exactly one authoritative location — the workspace notes', () => {
    // The template used to say "at the repo root" 100 lines below workspace
    // notes that named two other paths.
    const out = renderTicketPrompt(readFileSync(burnerTemplatePath(), 'utf8'), promptValues())
    expect(out).not.toMatch(/BLOCKED\.md at the repo root/i)
    expect(out).toMatch(/BLOCKED\.md`? — \*\*at the path given in "Where to work"/i)
    expect(out).toContain(`${ISOLATED_REPO_PATH}/BLOCKED.md`)
  })

  /**
   * The same prompts are handed to a codex agent, which does not run
   * `claude --print` and would be told a plain falsehood about its own process.
   * Naming the CLI is the only thing that has to go — the completion contract is
   * runtime-neutral already (sandcastle matches the signal against accumulated
   * stdout, whichever provider produced it).
   */
  it('names no runtime in any burner prompt', () => {
    const templates = [
      burnerTemplatePath(),
      resolverTemplatePath(),
      burnerAssetPath('review-ticket.md'),
      burnerAssetPath('research-waypoint.md'),
    ]

    for (const path of templates) {
      const template = readFileSync(path, 'utf8')
      // CLAUDE.md is a FILE in the repo, not a runtime — the review prompt
      // still points at it as the standards authority.
      const runtimeMentions = template.match(/claude(?!\.md)/gi) ?? []
      expect(runtimeMentions, `${path} mentions: ${runtimeMentions.join(', ')}`).toEqual([])
    }
  })

  it('keeps the completion contract in every prompt that signals one', () => {
    // Unchanged by the runtime work: sandcastle matches the signal against the
    // agent's accumulated stdout, so it is honoured identically on both
    // providers. (The research prompt has never signalled — it completes on git.)
    for (const path of [
      burnerTemplatePath(),
      resolverTemplatePath(),
      burnerAssetPath('review-ticket.md'),
    ]) {
      expect(readFileSync(path, 'utf8'), path).toContain('<promise>COMPLETE</promise>')
    }
  })

  it('drops the branches its sandbox cannot run', () => {
    const template = readFileSync(burnerTemplatePath(), 'utf8')
    // Linux node:22 image: there is no pwsh, and no docker inside the sandbox.
    expect(template).not.toMatch(/pwsh/i)
    expect(template).not.toContain('docker compose config -q')
  })

  it('does not tell the agent iterations share one worktree', () => {
    // Isolated mode (the win32/darwin default) re-clones every iteration, so
    // "uncommitted work from a previous iteration" was a lie about the default.
    const template = readFileSync(burnerTemplatePath(), 'utf8')
    expect(template).not.toMatch(/against the same worktree/i)
    expect(template).toMatch(/only commits carry across/i)
  })

  it('renders values containing $ and special chars safely', () => {
    const out = renderTicketPrompt('{{TICKET_JSON}}', promptValues({ TICKET_JSON: 'cost is $5 & rising' }))
    expect(out).toBe('cost is $5 & rising')
  })

  it('buildDocsDigest notes when no canonical docs are present', () => {
    expect(buildDocsDigest([])).toMatch(/No canonical feature docs/i)
  })

  /**
   * A fix ticket's only extra obligation (decision 8): nothing reviews it
   * afterwards, so it re-runs the reviewer's repro step itself and says so.
   */
  it('makes a fix ticket re-run its finding’s repro step, and leaves other tickets alone', () => {
    const template = readFileSync(burnerTemplatePath(), 'utf8')
    const fix = ticket(7, [], { originFindingId: 'finding_1' })

    const fixPrompt = renderTicketPrompt(template, promptValues({ FIX_NOTES: buildFixNotes(fix) }))
    expect(fixPrompt).toMatch(/re-run that repro step exactly/i)
    expect(fixPrompt).toMatch(/say in your digest that you re-ran it/i)

    const ordinary = renderTicketPrompt(template, promptValues())
    expect(buildFixNotes(ticket(4))).toBe('')
    expect(ordinary).not.toMatch(/repro step/i)
  })
})

describe('prompt cache prefix (the ordering contract)', () => {
  const template = readFileSync(burnerTemplatePath(), 'utf8')

  const sharedPrefix = (a: string, b: string): number => {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return i
  }

  it('puts every ticket-specific placeholder after every run-constant one', () => {
    const at = (key: string): number => template.indexOf(`{{${key}}}`)
    for (const key of [...RUN_CONSTANT_PLACEHOLDERS, ...TICKET_SPECIFIC_PLACEHOLDERS]) {
      expect(at(key), `${key} missing from the template`).toBeGreaterThanOrEqual(0)
    }
    const lastConstant = Math.max(...RUN_CONSTANT_PLACEHOLDERS.map(at))
    const firstSpecific = Math.min(...TICKET_SPECIFIC_PLACEHOLDERS.map(at))
    expect(firstSpecific).toBeGreaterThan(lastConstant)
  })

  it('two sibling tickets share almost the whole prompt as a common prefix', () => {
    const constant = promptValues()
    const a = renderTicketPrompt(template, {
      ...constant,
      TICKET_JSON: buildTicketJson(ticket(4)),
      BLOCKERS: buildBlockersBlock([], []),
    })
    const b = renderTicketPrompt(template, {
      ...constant,
      TICKET_JSON: buildTicketJson(ticket(9, [4])),
      BLOCKERS: buildBlockersBlock([4], [{ seq: 4, title: 'Ticket 4', digest: 'did a thing' }]),
    })
    const share = sharedPrefix(a, b) / Math.min(a.length, b.length)
    // Measured at 11.6% before the reorder; the guard is deliberately well
    // below the real figure so ordinary prose edits do not trip it.
    expect(share).toBeGreaterThan(0.8)
  })

  it('a ticket keeps its own prefix across a retry, since retry notes are appended', () => {
    const values = promptValues()
    const base = renderTicketPrompt(template, values)
    const retried = `${base}\n\n## Recovery context`
    expect(sharedPrefix(base, retried)).toBe(base.length)
  })
})

describe('buildBlockersBlock', () => {
  const digests: HarvestedDigest[] = [
    { seq: 2, title: 'Add the store', digest: 'Wrote `store.ts`.\n\nSurprises: none.' },
    { seq: 5, title: 'Wire the API', digest: 'Wired it.' },
  ]

  it('says so plainly when a ticket has no blockers', () => {
    expect(buildBlockersBlock([], digests)).toMatch(/no blockers/i)
  })

  it('renders each blocker seq, title and digest, and says the work already landed', () => {
    const out = buildBlockersBlock([5, 2], digests)
    expect(out).toContain('ticket 2 — Add the store')
    expect(out).toContain('ticket 5 — Wire the API')
    expect(out).toContain('Wrote `store.ts`.')
    expect(out).toMatch(/already landed/i)
    // The rediscovery loop this replaces.
    expect(out).toMatch(/do not go digging through `git log`/i)
    // Seq order, not the order the edges happened to be written in.
    expect(out.indexOf('ticket 2')).toBeLessThan(out.indexOf('ticket 5'))
  })

  it('names a blocker that left no digest rather than dropping it', () => {
    const out = buildBlockersBlock([7], digests)
    expect(out).toContain('ticket 7')
    expect(out).toMatch(/left no account/i)
  })
})

describe('buildLapDigestsBlock', () => {
  it('renders every implementer account in seq order', () => {
    const out = buildLapDigestsBlock([
      { seq: 3, title: 'Third', digest: 'c' },
      { seq: 1, title: 'First', digest: 'a' },
    ])
    expect(out.indexOf('ticket 1')).toBeLessThan(out.indexOf('ticket 3'))
    expect(out).toContain('First')
    expect(out).toContain('Third')
  })

  it('is explicit when the burn harvested nothing', () => {
    expect(buildLapDigestsBlock([])).toMatch(/No implementation ticket/i)
  })
})

describe('buildGuardNotes', () => {
  it('claims enforcement only when the hook is actually installed', () => {
    expect(buildGuardNotes(true)).toMatch(/denied before they run/i)
    expect(buildGuardNotes(false)).not.toMatch(/denied before they run/i)
    expect(buildGuardNotes(false)).toMatch(/not machine-enforced/i)
  })

  it('renders every denial reason verbatim from the guard rule table', () => {
    const notes = buildGuardNotes(true)

    for (const rule of GUARD_RULES) {
      expect(notes).toContain(`- ${rule.reason}`)
    }
  })
})

describe('buildDriveNotes', () => {
  const repoPath = mkdtempSync(join(tmpdir(), 'runcastle-drive-notes-'))

  it('spends two sentences on a project with no drive machinery at all', () => {
    const out = buildDriveNotes({ repoPath })
    expect(out).toMatch(/no test-drive machinery configured/i)
    expect(out).not.toContain('RUNCASTLE_SLUG')
    expect(out).not.toContain('drive.env')
    // The 3,283-byte block this replaces.
    expect(out.length).toBeLessThan(600)
  })

  it('quotes the commands the server actually runs when the project has them', () => {
    const out = buildDriveNotes({
      repoPath,
      driveSetupCommand: 'bun .runcastle/drive-setup.ts',
      devCommand: 'bun run dev',
    })
    expect(out).toContain('bun .runcastle/drive-setup.ts')
    expect(out).toContain('bun run dev')
    expect(out).toMatch(/introduces infrastructure the dev environment needs/i)
    // Never asserts a `.sh` file the project may not have.
    expect(out).not.toContain('drive-setup.sh')
    // Hermetic check survives; the impossible branches do not.
    expect(out).toMatch(/never run it/i)
    expect(out).not.toMatch(/pwsh/i)
    expect(out).not.toContain('docker compose config -q')
  })

  it('adds the `.runcastle/` contract facts only when that directory exists', () => {
    const withDir = mkdtempSync(join(tmpdir(), 'runcastle-drive-dir-'))
    mkdirSync(join(withDir, '.runcastle'))
    const out = buildDriveNotes({ repoPath: withDir })
    expect(out).toContain('.runcastle/drive.env')
    expect(out).toContain('RUNCASTLE_ID')
  })
})

describe('buildProjectStandards', () => {
  it('names the standards files by path, never by content', () => {
    const repo = mkdtempSync(join(tmpdir(), 'runcastle-standards-'))
    writeFileSync(join(repo, 'CLAUDE.md'), 'x'.repeat(5000), 'utf8')
    writeFileSync(join(repo, 'CONTEXT.md'), 'y'.repeat(5000), 'utf8')
    mkdirSync(join(repo, 'docs', 'adr'), { recursive: true })
    writeFileSync(join(repo, 'docs/adr/0001-live.md'), '# live', 'utf8')
    writeFileSync(join(repo, 'docs/adr/0002-dead.md'), '# dead\nsuperseded by ADR-0001', 'utf8')

    const out = buildProjectStandards(repo)
    expect(out).toContain('`CLAUDE.md`')
    expect(out).toContain('`CONTEXT.md`')
    expect(out).toContain('docs/adr/0001-live.md')
    // Superseded ADRs are not in the always-read set.
    expect(out).not.toContain('0002-dead.md')
    // By path, not by content — the whole point.
    expect(out).not.toContain('xxxxxxxxxx')
    expect(out.length).toBeLessThan(1500)
  })

  it('says so honestly when the repo documents nothing', () => {
    const repo = mkdtempSync(join(tmpdir(), 'runcastle-standards-empty-'))
    expect(buildProjectStandards(repo)).toMatch(/documents no standards of its own/i)
  })
})

describe('trimMapDoc', () => {
  const map = [
    '# Feature — map',
    '',
    '## Destination',
    'ship it',
    '',
    '## Notes',
    'a note',
    '',
    '## Not yet specified',
    'a waypoint',
    '',
    '## Out of scope',
    'never do this',
    '',
  ].join('\n')

  it('keeps Destination and Notes, drops the two negative-space sections', () => {
    const out = trimMapDoc(map, 'docs/features/x/map.md')
    expect(out).toContain('ship it')
    expect(out).toContain('a note')
    expect(out).not.toContain('a waypoint')
    expect(out).not.toContain('never do this')
    // Named, not silently dropped.
    expect(out).toContain('docs/features/x/map.md')
  })

  it('returns content untouched when there is nothing to drop', () => {
    const plain = '# map\n\n## Destination\nx\n'
    expect(trimMapDoc(plain, 'p')).toBe(plain)
  })
})

describe('readDocsDigest (the allowlist)', () => {
  const savedDataDir = process.env.RUNCASTLE_DATA_DIR
  afterAll(() => {
    if (savedDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = savedDataDir
  })

  /** A talk worktree with a feature docs dir, laid out where paths expects it. */
  function seedDocs(files: Record<string, string>): { projectId: string; slug: string } {
    process.env.RUNCASTLE_DATA_DIR = mkdtempSync(join(tmpdir(), 'runcastle-docs-data-'))
    const projectId = 'proj_docs'
    const slug = 'a-feature'
    const dir = join(worktreeDir(projectId, slug), 'docs', 'features', slug)
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      const p = join(dir, ...name.split('/'))
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    }
    return { projectId, slug }
  }

  const bigOutcome = `# outcome\n${'o'.repeat(50_000)}`

  it('inlines only the canonical docs and NAMES the rest with a reason', () => {
    const { projectId, slug } = seedDocs({
      'brief.md': '# brief\nthe brief',
      'spec.md': '# spec\nthe spec',
      'decisions.md': '# decisions\nthe decisions',
      'outcome.md': bigOutcome,
      'test-notes.md': `# notes\n${'n'.repeat(20_000)}`,
      'findings.md': '# findings\nstuff',
      'research/3-auth.md': '# auth research',
    })
    const docs = readDocsDigest(projectId, slug)

    expect(docs.included).toEqual(['brief.md', 'decisions.md', 'spec.md'])
    expect(docs.text).toContain('the spec')
    // The 52 KB postmortem that used to be the bulk of every coder's context.
    expect(docs.text).not.toContain('o'.repeat(100))
    expect(docs.text).not.toContain('n'.repeat(100))
    // But it is still NAMED, with its reason and its path.
    expect(docs.withheld.map((w) => w.name).sort()).toEqual([
      'findings.md',
      'outcome.md',
      'research/3-auth.md',
      'test-notes.md',
    ])
    expect(docs.text).toContain(`docs/features/${slug}/outcome.md`)
    expect(docs.text).toMatch(/human-facing/)
    expect(docs.text).toContain(`docs/features/${slug}/research/3-auth.md`)
    // The whole point: the digest is now a fraction of what was on disk.
    expect(docs.bytes).toBeLessThan(3_000)
  })

  it('orders the canonical docs brief → map → decisions → spec whatever the FS says', () => {
    const { projectId, slug } = seedDocs({
      'spec.md': '# spec',
      'decisions.md': '# decisions',
      'map.md': '# map\n\n## Destination\nthere',
      'brief.md': '# brief',
    })
    const docs = readDocsDigest(projectId, slug)
    expect(docs.included).toEqual(['brief.md', 'map.md', 'decisions.md', 'spec.md'])
  })

  it('trims the map to the sections a coder may act on', () => {
    const { projectId, slug } = seedDocs({
      'map.md': '# map\n\n## Destination\nthere\n\n## Out of scope\nforbidden fruit\n',
    })
    const docs = readDocsDigest(projectId, slug)
    expect(docs.text).toContain('there')
    expect(docs.text).not.toContain('forbidden fruit')
  })

  it('reports a spec-less burn instead of hiding it in one italic line', () => {
    process.env.RUNCASTLE_DATA_DIR = mkdtempSync(join(tmpdir(), 'runcastle-docs-none-'))
    expect(readDocsDigest('proj_none', 'nope').missing).toBe('no-worktree')

    const { projectId, slug } = seedDocs({ 'outcome.md': '# outcome' })
    const docs = readDocsDigest(projectId, slug)
    expect(docs.missing).toBe('no-canonical-docs')
    // Still names what IS there.
    expect(docs.withheld.map((w) => w.name)).toEqual(['outcome.md'])
  })
})

describe('parseEnvFile', () => {
  it('parses KEY=VALUE, skipping comments and blanks, stripping quotes and export', () => {
    const env = parseEnvFile(
      [
        '# a comment',
        '',
        'CLAUDE_CODE_OAUTH_TOKEN=abc123',
        'export QUOTED="hello world"',
        "SINGLE='sq'",
        'WITH_EQUALS=a=b=c',
        '   # indented comment',
        'SPACED = spaced value ',
      ].join('\n'),
    )
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('abc123')
    expect(env.QUOTED).toBe('hello world')
    expect(env.SINGLE).toBe('sq')
    expect(env.WITH_EQUALS).toBe('a=b=c')
    expect(env.SPACED).toBe('spaced value')
  })

  it('ignores lines without an =', () => {
    expect(parseEnvFile('JUST_A_KEY\n=novalue')).toEqual({})
  })
})

describe('createStreamThrottle', () => {
  it('buffers text under the thresholds and flushes on demand', () => {
    const emitted: { type: string; message: string }[] = []
    const th = createStreamThrottle((e) => emitted.push(e), { now: () => 1000 })
    th.onEvent(textEvent('aa'))
    th.onEvent(textEvent('bb'))
    expect(emitted).toHaveLength(0)
    th.flush()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ type: 'burn.text', message: 'aabb' })
  })

  it('flushes text once it exceeds maxChars', () => {
    const emitted: { type: string; message: string }[] = []
    const th = createStreamThrottle((e) => emitted.push(e), { maxChars: 5, now: () => 0 })
    th.onEvent(textEvent('123456'))
    expect(emitted).toHaveLength(1)
    expect(emitted[0].message).toBe('123456')
  })

  it('flushes text after the interval elapses', () => {
    const emitted: { type: string; message: string }[] = []
    let t = 0
    const th = createStreamThrottle((e) => emitted.push(e), { intervalMs: 2000, now: () => t })
    th.onEvent(textEvent('a'))
    expect(emitted).toHaveLength(0)
    t = 2001
    th.onEvent(textEvent('b'))
    expect(emitted).toHaveLength(1)
    expect(emitted[0].message).toBe('ab')
  })

  it('emits a toolCall immediately, flushing pending text first (never per-token)', () => {
    const emitted: { type: string; message: string }[] = []
    const th = createStreamThrottle((e) => emitted.push(e), { now: () => 0 })
    th.onEvent(textEvent('thinking'))
    th.onEvent(toolEvent('Edit', '{"file":"a.ts"}'))
    expect(emitted.map((e) => e.type)).toEqual(['burn.text', 'burn.tool'])
    expect(emitted[1].message).toContain('Edit')
  })
})

describe('interpretRunResult', () => {
  it('marks done when commits landed', () => {
    expect(interpretRunResult({ commits: [{ sha: 'a1' }, { sha: 'b2' }] }, undefined)).toEqual({
      status: 'done',
      commits: ['a1', 'b2'],
    })
  })

  it('marks failed with BLOCKED.md content on zero commits', () => {
    const out = interpretRunResult({ commits: [] }, 'need the API key')
    expect(out.status).toBe('failed')
    expect(out.status === 'failed' && out.error).toContain('need the API key')
  })

  it('marks failed "agent made no commits" on zero commits + no BLOCKED.md', () => {
    expect(interpretRunResult({ commits: [] }, undefined)).toEqual({
      status: 'failed',
      error: 'agent made no commits',
    })
  })
})

describe('isMergeConflictError', () => {
  it('recognises conflict-shaped error messages', () => {
    expect(isMergeConflictError(new Error('CONFLICT (content): merge failed'))).toBe(true)
    expect(isMergeConflictError(new Error('resolve then run: git branch -D sandcastle/x'))).toBe(
      true,
    )
    expect(isMergeConflictError(new Error('Automatic merge failed; fix conflicts'))).toBe(true)
  })

  it('does not flag unrelated errors', () => {
    expect(isMergeConflictError(new Error('image not found locally'))).toBe(false)
    expect(isMergeConflictError('boom')).toBe(false)
  })
})

describe('isWorktreeTeardownError', () => {
  it('recognises sandcastle failing to remove its worktree after the run', () => {
    // The real one, from a Windows burn: git's stderr, verbatim.
    expect(
      isWorktreeTeardownError(
        new Error(
          "error: failed to delete 'C:/Users/me/Projects/helix/.sandcastle/worktrees/runcastle-ticket-make-act-1-more-6-gX46ogOP': Directory not empty",
        ),
      ),
    ).toBe(true)
    expect(
      isWorktreeTeardownError(
        new Error(
          'ENOTEMPTY: directory not empty, rmdir ' +
            'C:\\repo\\.sandcastle\\worktrees\\runcastle-ticket-x-1-abc',
        ),
      ),
    ).toBe(true)
    expect(
      isWorktreeTeardownError(
        new Error("fatal: '/repo/.sandcastle/worktrees/runcastle-ticket-x-1-abc' is not a working tree"),
      ),
    ).toBe(true)
    expect(
      isWorktreeTeardownError(
        new Error('EBUSY: resource busy or locked, unlink /repo/.sandcastle/worktrees/wt-1/node_modules/.bin/x'),
      ),
    ).toBe(true)
  })

  it('needs BOTH the worktree path and a removal failure — never an agent failure', () => {
    // Removal wording without the worktree path: some other dir entirely.
    expect(isWorktreeTeardownError(new Error('ENOTEMPTY: directory not empty, rmdir /tmp/x'))).toBe(
      false,
    )
    // The worktree path without removal wording: a mid-run failure quoting it.
    expect(
      isWorktreeTeardownError(
        new Error('claude-code exited with code 1: cwd /repo/.sandcastle/worktrees/wt-1'),
      ),
    ).toBe(false)
    expect(isWorktreeTeardownError(new Error('authentication_error: unauthorized'))).toBe(false)
    expect(isWorktreeTeardownError('boom')).toBe(false)
    expect(isWorktreeTeardownError(undefined)).toBe(false)
  })

  it('stays FATAL under classifyTicketRunError — so the teardown check must come first', () => {
    // Documents why the burner tests this before classifying: a blind retry
    // would re-run an agent over work that is already committed.
    const err = new Error(
      "error: failed to delete '/repo/.sandcastle/worktrees/wt-1': Directory not empty",
    )
    expect(classifyTicketRunError(err)).toBe('fatal')
    expect(isWorktreeTeardownError(err)).toBe(true)
  })
})

/** A resolved model per runtime — what `resolveModelEntry` hands the chokepoint. */
const CLAUDE_MODEL: ModelEntry = { id: 'claude-opus-5', runtime: 'claude-code' }
const CODEX_MODEL: ModelEntry = { id: 'gpt-5.6-sol', runtime: 'codex' }

describe('resolveTicketModel — an assignment is that ticket’s run override', () => {
  const config = {
    model: 'claude-sonnet-5',
    stepModels: { implement: 'claude-opus-5' },
    models: [{ id: 'gpt-5.6-sol', runtime: 'codex' as const, note: 'mechanical refactors' }],
  }

  it('burns an assigned ticket on its own model, runtime and all', () => {
    expect(
      resolveTicketModel(config, null, null, ticket(1, [], { model: 'gpt-5.6-sol' })),
    ).toEqual({ id: 'gpt-5.6-sol', runtime: 'codex', note: 'mechanical refactors' })
  })

  it('leaves an unassigned ticket on the unchanged default chain', () => {
    // No assignment: the `implement` step override wins, exactly as before
    // per-ticket models existed.
    expect(resolveTicketModel(config, null, null, ticket(2))).toEqual({
      id: 'claude-opus-5',
      runtime: 'claude-code',
    })
    // …and the per-project override still beats that step override.
    expect(resolveTicketModel(config, { model: 'claude-haiku-4-5' }, null, ticket(2)).id).toBe(
      'claude-haiku-4-5',
    )
  })

  it('beats the run-level override for the ticket that carries one, not for the rest', () => {
    expect(
      resolveTicketModel(config, null, 'claude-haiku-4-5', ticket(3, [], { model: 'gpt-5.6-sol' }))
        .id,
    ).toBe('gpt-5.6-sol')
    expect(resolveTicketModel(config, null, 'claude-haiku-4-5', ticket(4)).id).toBe(
      'claude-haiku-4-5',
    )
  })
})

describe('selectSandbox — provider for the configured sandbox', () => {
  const config = (sandbox: RuncastleConfig['sandbox']): RuncastleConfig => ({
    serverPort: 4512,
    model: 'm',
    stepModels: {},
    sandbox,
  })

  it('maps each choice to its sandcastle provider', () => {
    expect(selectSandbox(config('docker')).name).toBe('docker')
    expect(selectSandbox(config('podman')).name).toBe('podman')
    expect(selectSandbox(config('noSandbox')).name).toBe('no-sandbox')
  })

  it('refuses a sandbox it has no provider for instead of falling back to the host', () => {
    // A sandbox choice that reaches config without a provider here used to fall
    // through to `noSandbox()` — the agent ran on the operator's machine, and
    // nothing in the run said so.
    const unsupported = { ...config('docker'), sandbox: 'kata' } as unknown as RuncastleConfig
    expect(() => selectSandbox(unsupported)).toThrow(/refusing to run the agent unsandboxed/)
  })

  /**
   * `~/.runcastle/.env` holds both providers' credentials side by side; which
   * one a run needs follows from its resolved model's runtime.
   */
  describe('readTokenFromEnvFile — the runtime picks the key', () => {
    const envFile = (content: string): string => {
      const path = join(mkdtempSync(join(tmpdir(), 'rc-env-')), '.env')
      writeFileSync(path, content, 'utf8')
      return path
    }

    // The reader falls back to the host env, so the "unauthed" cases below only
    // mean anything with the real ones cleared.
    beforeEach(() => {
      vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '')
      vi.stubEnv('CODEX_API_KEY', '')
    })
    afterEach(() => vi.unstubAllEnvs())

    it('reads each runtime its own key out of one file', () => {
      const path = envFile('CLAUDE_CODE_OAUTH_TOKEN=sk-claude\nCODEX_API_KEY=sk-openai\n')

      expect(readTokenFromEnvFile(path, 'claude-code')).toBe('sk-claude')
      expect(readTokenFromEnvFile(path, 'codex')).toBe('sk-openai')
    })

    it('reports a runtime unauthed when only the other one is — the precheck seam', () => {
      // The whole point of the fail-early check: a Claude token in the file
      // does nothing for a codex burn, and the run must say so before it
      // spends minutes building a container that cannot authenticate.
      const path = envFile('CLAUDE_CODE_OAUTH_TOKEN=sk-claude\n')

      expect(readTokenFromEnvFile(path, 'claude-code')).toBe('sk-claude')
      expect(readTokenFromEnvFile(path, 'codex')).toBeUndefined()
    })

    it('treats an empty value and a missing file alike', () => {
      expect(readTokenFromEnvFile(envFile('CODEX_API_KEY=\n'), 'codex')).toBeUndefined()
      expect(readTokenFromEnvFile('/no/such/.env', 'codex')).toBeUndefined()
    })
  })

  /**
   * The env handed to the spawned CLI. A replacement env (the token alone)
   * strips HOME/USERPROFILE, and an agent with no home writes its state to a
   * LITERAL `~/` under its cwd — that is how a 284 KB transcript for an
   * unrelated project got committed under `packages/server/`. In a container the
   * opposite holds: the host env must not cross the boundary, because both
   * providers turn this map into `-e` flags.
   */
  describe('buildBurnAgent — child environment', () => {
    const homeKeys = ['HOME', 'USERPROFILE'] as const

    it('keeps the host environment alongside the token when running on the host', () => {
      const env = buildBurnAgent(config('noSandbox'), 'sk-token', CLAUDE_MODEL).env

      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-token')
      const present = homeKeys.filter((key) => process.env[key] !== undefined)
      expect(present.length, 'this host has neither HOME nor USERPROFILE').toBeGreaterThan(0)
      for (const key of present) expect(env[key]).toBe(process.env[key])
    })

    it('keeps the host environment when there is no token to pass', () => {
      const env = buildBurnAgent(config('noSandbox'), undefined, CLAUDE_MODEL).env
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(env.PATH ?? env.Path).toBeDefined()
    })

    it('sends only the overrides into a container, never the host env', () => {
      const env = buildBurnAgent(config('docker'), 'sk-token', CLAUDE_MODEL).env
      expect(env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-token' })
    })

    // A hand-set CODEX_API_KEY still crosses the boundary, where Codex's own
    // precedence lets it win over the borrowed login (decision 3) — an
    // upgrade-safe escape hatch for deliberate API billing.
    it('still carries a CODEX_API_KEY the operator set by hand', () => {
      const env = buildBurnAgent(config('docker'), 'sk-openai', CODEX_MODEL).env
      expect(env).toEqual({ CODEX_API_KEY: 'sk-openai' })
    })

    // The normal case now: no key anywhere, and the burn proceeds regardless —
    // it authenticates on the `auth.json` copied out of the read-only mount.
    it('burns codex with an empty container env when there is no key to pass', () => {
      const env = buildBurnAgent(config('docker'), undefined, CODEX_MODEL).env
      expect(env).toEqual({})
    })
  })

  /**
   * The chokepoint every headless agent is built at. The model's runtime picks
   * the CLI — that is the whole of decision 2 — and the rendered print command
   * is where it becomes observable without spawning anything.
   */
  describe('buildBurnAgent — runtime selection', () => {
    const printCommand = (agent: ReturnType<typeof buildBurnAgent>): string =>
      agent.buildPrintCommand({ prompt: 'do the ticket' }).command

    it('builds a claude agent for a claude-runtime model', () => {
      const agent = buildBurnAgent(config('docker'), 'sk-token', CLAUDE_MODEL)
      expect(agent.name).toBe('claude-code')
      expect(printCommand(agent)).toContain("--model 'claude-opus-5'")
    })

    it('builds a codex agent for a codex-runtime model', () => {
      const agent = buildBurnAgent(config('docker'), 'sk-openai', CODEX_MODEL)
      expect(agent.name).toBe('codex')
      const command = printCommand(agent)
      expect(command).toContain('codex exec')
      expect(command).toContain("-m 'gpt-5.6-sol'")
      expect(command).not.toContain('claude')
    })

    // Writing $HOME/.codex/hooks.json is necessary but not sufficient: codex
    // runs no hook it has no persisted trust for, so without the flag the guard
    // we just installed is silently inert.
    it('un-gates the guard hooks it installed itself, and only those', () => {
      const guarded = buildBurnAgent(config('docker'), 'k', CODEX_MODEL, { bypassHookTrust: true })
      expect(printCommand(guarded)).toContain('--dangerously-bypass-hook-trust')

      const unguarded = buildBurnAgent(config('docker'), 'k', CODEX_MODEL)
      expect(printCommand(unguarded)).not.toContain('--dangerously-bypass-hook-trust')
    })

    it('gives a codex review agent the same run-scoped MCP server as claude', () => {
      const mcp = {
        path: '/data/review/mcp.json',
        config: {
          mcpServers: {
            runcastle: {
              type: 'http' as const,
              url: 'http://127.0.0.1:4512/mcp',
              headers: { 'X-Runcastle-Run': 'run_abc123' },
            },
          },
        },
      }

      const claudeCommand = printCommand(
        buildBurnAgent(config('noSandbox'), undefined, CLAUDE_MODEL, { onHost: true, mcp }),
      )
      expect(claudeCommand).toContain('--mcp-config "/data/review/mcp.json"')

      // Codex has no --mcp-config; the same server rides `-c` dotted overrides.
      const codexCommand = printCommand(
        buildBurnAgent(config('noSandbox'), undefined, CODEX_MODEL, { onHost: true, mcp }),
      )
      expect(codexCommand).toContain('-c mcp_servers.runcastle.url="http://127.0.0.1:4512/mcp"')
      expect(codexCommand).toContain(
        '-c mcp_servers.runcastle.http_headers.X-Runcastle-Run="run_abc123"',
      )
    })
  })

  describe('buildSandboxOptions — container resource wiring', () => {
    it('omits cpus entirely when burnCpus is unset (unconstrained default)', () => {
      const opts = buildSandboxOptions(config('docker'))
      expect('cpus' in opts).toBe(false)
      expect(opts.imageName).toBe(DEFAULT_SANDBOX_IMAGE)
    })

    it('passes burnCpus through as the provider --cpus ceiling', () => {
      expect(buildSandboxOptions({ ...config('docker'), burnCpus: 2.5 }).cpus).toBe(2.5)
    })

    it('keeps cache mounts alongside the cpu ceiling', () => {
      const mount = { hostPath: '/host/cache', sandboxPath: '~/.npm' }
      const opts = buildSandboxOptions({ ...config('docker'), burnCpus: 1 }, [mount])
      expect(opts.mounts).toEqual([mount])
      expect(opts.cpus).toBe(1)
    })

    it('omits mounts when there are none, so the provider default applies', () => {
      expect('mounts' in buildSandboxOptions(config('docker'))).toBe(false)
    })
  })

  /**
   * The borrowed ChatGPT login (decision 1). A container burn authenticates on
   * the operator's own `codex login` — the host Codex home rides in read-only
   * and the sandbox-ready command copies the one file out of it — so there is
   * no second, differently-billed credential to mint.
   */
  describe('codexAuthMountFor — lending a container the host login', () => {
    const HOME_ENV = { CODEX_HOME: join('/host', '.codex') }
    const loggedIn = () => true
    const loggedOut = () => false

    it('mounts the host Codex home read-only for a codex container burn', () => {
      const mount = codexAuthMountFor('codex', 'docker', HOME_ENV, loggedIn)

      expect(mount).toEqual({
        hostPath: join('/host', '.codex'),
        sandboxPath: '/mnt/host-codex',
        readonly: true,
      })
      // podman borrows the same way — the mount follows the runtime, not the provider.
      expect(codexAuthMountFor('codex', 'podman', HOME_ENV, loggedIn)).toEqual(mount)
      expect(buildSandboxOptions(config('docker'), [mount!]).mounts).toEqual([mount])
    })

    it('lends nothing to a noSandbox burn, which already runs in the real home', () => {
      expect(codexAuthMountFor('codex', 'noSandbox', HOME_ENV, loggedIn)).toBeUndefined()
    })

    it('lends nothing to a claude-code burn, in any sandbox', () => {
      expect(codexAuthMountFor('claude-code', 'docker', HOME_ENV, loggedIn)).toBeUndefined()
      expect(codexAuthMountFor('claude-code', 'noSandbox', HOME_ENV, loggedIn)).toBeUndefined()
    })

    // A hostPath that does not exist fails sandbox creation outright, and an
    // operator burning on a hand-set CODEX_API_KEY has no login to lend.
    it('lends nothing when the host has never logged in', () => {
      expect(codexAuthMountFor('codex', 'docker', HOME_ENV, loggedOut)).toBeUndefined()
    })
  })

  /**
   * What "ready to burn unattended" means per runtime. Claude Code needs the
   * long-lived token; Codex needs a login, and a key is only the silent
   * override an operator may already have in `~/.runcastle/.env`.
   */
  describe('burnAuthReady — the fail-early predicate', () => {
    const loggedIn = () => true
    const loggedOut = () => false

    it('burns codex on the host login alone, with no key anywhere', () => {
      expect(burnAuthReady('codex', undefined, loggedIn)).toBe(true)
    })

    it('refuses a codex burn when the host is logged out and has no key', () => {
      expect(burnAuthReady('codex', undefined, loggedOut)).toBe(false)
    })

    it('accepts a hand-set CODEX_API_KEY as the override it is', () => {
      expect(burnAuthReady('codex', 'sk-openai', loggedOut)).toBe(true)
    })

    it('leaves claude-code on its token, whatever codex’s login says', () => {
      expect(burnAuthReady('claude-code', 'sk-token', loggedOut)).toBe(true)
      expect(burnAuthReady('claude-code', undefined, loggedIn)).toBe(false)
    })
  })

  describe('buildCodexAuthCopyCommand — auth.json and nothing else', () => {
    it('copies auth.json from the mount into the container’s own Codex home', () => {
      const command = buildCodexAuthCopyCommand()

      expect(command).toBe(
        'mkdir -p "$HOME/.codex" && cp "/mnt/host-codex/auth.json" "$HOME/.codex/auth.json"',
      )
      // The image runs as a non-root user, so the home is whoever that is.
      expect(command).not.toContain('/home/agent')
    })

    // An operator's interactive settings — sandbox mode, approval policy,
    // trusted projects — must not leak into a print-mode burn.
    it('never copies config.toml', () => {
      expect(buildCodexAuthCopyCommand()).not.toContain('config.toml')
    })
  })

  describe('chainSetupCommands — the sandbox-ready order', () => {
    it('borrows the login, arms the guard, then installs deps', () => {
      expect(chainSetupCommands('borrow-login', 'install-guard', 'bun install')).toBe(
        'borrow-login && install-guard && bun install',
      )
    })

    it('drops the steps that do not apply', () => {
      expect(chainSetupCommands(undefined, 'install-guard', undefined)).toBe('install-guard')
      expect(chainSetupCommands(undefined, undefined, undefined)).toBeUndefined()
    })

    // The whole point of the order: the agent cannot authenticate at all until
    // the copy has run, and the guard must be armed before its first tool call.
    it('renders a codex burn’s command with the copy ahead of the guard and the install', () => {
      const command = chainSetupCommands(
        buildCodexAuthCopyCommand(),
        buildGuardInstallCommand('codex'),
        'bun install',
      )

      expect(command?.startsWith(buildCodexAuthCopyCommand())).toBe(true)
      expect(command?.indexOf(CODEX_HOST_MOUNT_PATH)).toBeLessThan(
        command?.indexOf('$HOME/.codex/hooks.json') ?? -1,
      )
      expect(command?.endsWith('bun install')).toBe(true)
    })

    it('leaves a claude-code burn’s command exactly as it was — guard, then install', () => {
      const guard = buildGuardInstallCommand('claude-code')

      expect(chainSetupCommands(undefined, guard, 'bun install')).toBe(`${guard} && bun install`)
    })
  })
})

describe('classifyToolCall — where a burn spends its wall-clock', () => {
  const bash = (cmd: string) => classifyToolCall('Bash', cmd)

  it('maps the non-Bash file tools by name', () => {
    expect(classifyToolCall('Read', 'src/a.ts')).toBe('file-read')
    expect(classifyToolCall('Grep', 'pattern')).toBe('search')
    expect(classifyToolCall('Edit', 'src/a.ts')).toBe('file-edit')
    expect(classifyToolCall('Write', 'src/a.ts')).toBe('file-edit')
    expect(classifyToolCall('Task', 'explore')).toBe('other')
  })

  it('charges a chained command to its dominant cost, not its first word', () => {
    // Burn agents chain hard; the suite is what the line costs, not the grep.
    expect(bash('cd /repo && pnpm test > /tmp/t.log 2>&1; grep -E "Tests" /tmp/t.log')).toBe('tests')
    expect(bash('cd /repo && git stash -u && pnpm --filter web test')).toBe('tests')
    expect(bash('cat pkg.json && pnpm typecheck')).toBe('typecheck')
  })

  it('does not read a filename as the tool being run', () => {
    // Regression: `\bvitest\b` matched inside `vitest.config.ts`, charging a
    // grep of the test CONFIG to the test suite.
    expect(bash('grep -n "setupFiles" vite.config.ts vitest.config.ts | head -20')).toBe('search')
    expect(bash('wc -l src/build.ts')).toBe('file-read')
    expect(bash('pnpm vitest run src/a.test.ts')).toBe('tests')
    expect(bash('npx vitest --shard=1/4')).toBe('tests')
    // A test-ish FILE argument to a different tool is not a test run.
    expect(bash('npx prettier --write src/a.test.ts')).toBe('lint')
  })

  it('recognises a workspace-filtered test script, the form this repo uses', () => {
    expect(bash('pnpm --filter web test')).toBe('tests')
    expect(bash('pnpm --filter @acme/api run test')).toBe('tests')
    // …but never across a command separator into an unrelated segment.
    expect(bash('pnpm --filter web typecheck && cat test.ts')).toBe('typecheck')
  })

  it('does not read a quoted argument as the command', () => {
    expect(bash('grep -rn "pnpm test" src/')).toBe('search')
    expect(bash("grep -n 'eslint' package.json")).toBe('search')
  })

  it('ignores heredoc bodies but keeps the heredoc itself as an edit', () => {
    const cmd = [
      "cd /repo && python3 - <<'PY'",
      "p = 'src/a.test.ts'",
      "open(p,'w').write('vitest describe eslint build')",
      'PY',
    ].join('\n')
    // The body writes a spec mentioning three other categories; the cost here
    // is the file rewrite.
    expect(bash(cmd)).toBe('file-edit')
  })

  it('separates shell reading from shell searching, so each prompt rule is measurable', () => {
    expect(bash('cd /repo && cat src/a.ts')).toBe('file-read')
    expect(bash('cd /repo && sed -n "1,80p" src/a.ts')).toBe('file-read')
    expect(bash('cd /repo && rg --files-with-matches foo')).toBe('search')
    expect(bash('cd /repo && git log --oneline -15')).toBe('git')
    expect(bash('corepack pnpm install --frozen-lockfile')).toBe('install')
    expect(bash('echo hi')).toBe('other')
  })
})

describe('createToolTimer — category shares from the sandcastle stream', () => {
  const at = (ms: number) => new Date(1_000_000 + ms)
  const tool = (name: string, args: string, ms: number, iteration = 1) =>
    ({ type: 'toolCall', name, formattedArgs: args, iteration, timestamp: at(ms) }) as const
  const text = (ms: number, iteration = 1) =>
    ({ type: 'text', message: 'thinking', iteration, timestamp: at(ms) }) as const

  it('charges each gap to the event that opened it', () => {
    const t = createToolTimer()
    t.onEvent(tool('Bash', 'pnpm test', 0)) // 10s of tests
    t.onEvent(text(10_000)) //  2s of model
    t.onEvent(tool('Bash', 'cat a.ts', 12_000)) //  1s of file-read
    t.onEvent(text(13_000))
    const s = t.summary()
    expect(s.byCategory.tests).toEqual({ calls: 1, ms: 10_000 })
    expect(s.byCategory.model).toEqual({ calls: 0, ms: 2_000 })
    expect(s.byCategory['file-read']).toEqual({ calls: 1, ms: 1_000 })
    expect(s.calls).toBe(2)
    expect(s.totalMs).toBe(13_000)
  })

  it('drops the gap across an iteration boundary — that is a container rebuild', () => {
    const t = createToolTimer()
    t.onEvent(tool('Bash', 'pnpm test', 0, 1))
    t.onEvent(tool('Bash', 'git log', 500_000, 2)) // new container, not 8min of tests
    expect(t.summary().byCategory.tests?.ms).toBe(0) // the call is counted, its 8min gap is not
    expect(t.summary().byCategory.tests?.calls).toBe(1)
  })

  it('drops an implausibly long single gap rather than letting a stall swamp the shares', () => {
    const t = createToolTimer()
    t.onEvent(tool('Bash', 'pnpm test', 0))
    t.onEvent(text(45 * 60_000))
    expect(t.summary().totalMs).toBe(0)
  })

  it('ignores raw lines and counts calls even when no time is attributable', () => {
    const t = createToolTimer()
    t.onEvent({ type: 'raw', line: 'noise', iteration: 1, timestamp: at(0) })
    t.onEvent(tool('Bash', 'pnpm test', 0))
    const s = t.summary()
    expect(s.calls).toBe(1)
    expect(s.totalMs).toBe(0)
  })

  it('formats a share digest ordered by cost', () => {
    const t = createToolTimer()
    t.onEvent(tool('Bash', 'pnpm test', 0))
    t.onEvent(tool('Bash', 'cat a.ts', 60_000))
    t.onEvent(text(80_000))
    expect(formatTimingSummary(t.summary())).toMatch(/tests 75%/)
    expect(formatTimingSummary({ totalMs: 0, calls: 0, byCategory: {} })).toMatch(/no measurable/)
  })
})

describe('ticket.timing — the one span a ticket duration may be read from', () => {
  const empty = { totalMs: 0, calls: 0, byCategory: {} }

  it('bounds the execution with its own wall clock, whatever the stream said', () => {
    // 5m 35s of wall clock and no attributable tool time at all: the review
    // that read as 5.2 hours off its append-only log file.
    const t = buildTicketTiming(empty, 1_000_000, 1_335_000)
    expect(t.wallMs).toBe(335_000)
    expect(t.startedAt).toBe(1_000_000)
    expect(t.endedAt).toBe(1_335_000)
    expect(formatTicketTiming(t)).toBe('5:35')
  })

  it('keeps the category breakdown alongside the wall clock', () => {
    const t = buildTicketTiming(
      { totalMs: 60_000, calls: 2, byCategory: { tests: { calls: 1, ms: 60_000 } } },
      0,
      120_000,
    )
    expect(t.byCategory.tests).toEqual({ calls: 1, ms: 60_000 })
    expect(formatTicketTiming(t)).toMatch(/^2:00 \(.*tests 100%\)$/)
  })

  it('never reports a negative span when the clock steps back mid-execution', () => {
    expect(buildTicketTiming(empty, 5_000, 4_000).wallMs).toBe(0)
  })

  it('emits the same event shape for a ticket that made no tool calls', () => {
    const events: { type: string; ticketId?: string; data?: unknown }[] = []
    const ctx = { emitEvent: (e: (typeof events)[number]) => events.push(e) }
    emitTicketTiming(
      ctx as unknown as Parameters<typeof emitTicketTiming>[0],
      { id: 'tk_1', seq: 4 },
      buildTicketTiming(empty, 0, 335_000),
    )
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('ticket.timing')
    expect(events[0]?.ticketId).toBe('tk_1')
    expect(events[0]?.data).toMatchObject({ wallMs: 335_000, startedAt: 0, endedAt: 335_000 })
  })
})

describe('buildVerifyNotes — the prompt block that bounds verification spend', () => {
  it('states configured commands verbatim and forbids hunting for alternatives', () => {
    const out = buildVerifyNotes({ verifyCommands: 'pnpm --filter @acme/web test' })
    expect(out).toContain('pnpm --filter @acme/web test')
    // The point of configuring commands is that agents stop guessing filter
    // names by running whole suites that error out.
    expect(out).toMatch(/do not go looking for alternatives|guess/i)
  })

  it('tells the agent to derive commands once when none are configured', () => {
    const out = buildVerifyNotes({})
    expect(out).toMatch(/ONCE/)
    expect(out).toMatch(/package\.json/i)
  })

  it('renders a configured baseline and retires the pre-work full-suite run', () => {
    const out = buildVerifyNotes({ knownFailures: '13 failures across 6 suites (credits, threads)' })
    expect(out).toContain('13 failures across 6 suites')
    expect(out).toMatch(/do NOT spend a run establishing it yourself/)
  })

  it('falls back to capture-the-baseline-once when none is configured', () => {
    const out = buildVerifyNotes({})
    expect(out).toMatch(/capture the baseline ONCE/i)
    expect(out).toMatch(/Never re-run a whole suite/i)
  })

  it('covers both halves independently — one configured, one not', () => {
    const out = buildVerifyNotes({ verifyCommands: 'bun test' })
    expect(out).toContain('bun test')
    expect(out).toMatch(/No pre-existing-failure baseline is configured/)
  })

  it('treats whitespace-only config as unset', () => {
    expect(buildVerifyNotes({ verifyCommands: '   \n ', knownFailures: '  ' })).toBe(
      buildVerifyNotes({}),
    )
  })
})

describe('setup-command detection (deps install before the agent starts)', () => {
  const tc = (over: Partial<RepoToolchain> = {}): RepoToolchain => ({
    hasPackageJson: true,
    lockfiles: { bun: false, pnpm: false, yarn: false, npm: false },
    ...over,
  })
  const locks = (over: Partial<RepoToolchain['lockfiles']>): RepoToolchain['lockfiles'] => ({
    bun: false,
    pnpm: false,
    yarn: false,
    npm: false,
    ...over,
  })

  it('the packageManager field (corepack pin) wins over lockfiles', () => {
    const t = tc({ packageManagerField: 'pnpm@9.6.0', lockfiles: locks({ yarn: true }) })
    expect(detectPackageManager(t)).toBe('pnpm')
  })

  it('falls back to lockfile presence in bun → pnpm → yarn → npm order', () => {
    expect(detectPackageManager(tc({ lockfiles: locks({ bun: true, pnpm: true }) }))).toBe('bun')
    expect(detectPackageManager(tc({ lockfiles: locks({ pnpm: true, yarn: true }) }))).toBe('pnpm')
    expect(detectPackageManager(tc({ lockfiles: locks({ yarn: true, npm: true }) }))).toBe('yarn')
    expect(detectPackageManager(tc({ lockfiles: locks({ npm: true }) }))).toBe('npm')
  })

  it('an unknown packageManager field falls back to lockfiles', () => {
    const t = tc({ packageManagerField: 'deno@2.0.0', lockfiles: locks({ pnpm: true }) })
    expect(detectPackageManager(t)).toBe('pnpm')
  })

  it('a bare package.json defaults to npm; no package.json means no toolchain', () => {
    expect(detectPackageManager(tc())).toBe('npm')
    expect(detectPackageManager(tc({ hasPackageJson: false }))).toBeUndefined()
  })

  it('uses frozen installs only when the matching lockfile exists', () => {
    expect(resolveSetupCommand(tc({ lockfiles: locks({ bun: true }) }))).toBe(
      '( bun install --frozen-lockfile || bun install )',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ pnpm: true }) }))).toBe(
      '( corepack pnpm install --frozen-lockfile || corepack pnpm install )',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ yarn: true }) }))).toBe(
      '( corepack yarn install --frozen-lockfile || corepack yarn install )',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ npm: true }) }))).toBe(
      '( npm ci || npm install )',
    )
    expect(resolveSetupCommand(tc())).toBe('npm install')
    expect(resolveSetupCommand(tc({ packageManagerField: 'pnpm@9.0.0' }))).toBe(
      'corepack pnpm install',
    )
  })

  /**
   * Regression — both halves measured against real repos on 2026-07-28, each of
   * which killed a preparation run in the pre-agent install hook:
   *
   * - `exam-forge`: `package-lock.json` present on the host but UNTRACKED, so
   *   the `isolated`-mode `git clone` did not carry it and `npm ci` died with
   *   EUSAGE before the agent ran once.
   * - `wasla`: `package-lock.json` tracked but out of sync with package.json,
   *   so `npm ci` refused it ("Missing: @emnapi/runtime@1.11.3 from lock file").
   *
   * Both are recoverable by the permissive install, so neither may be fatal.
   */
  it('falls back to a permissive install when the strict one cannot hold', () => {
    const cmd = resolveSetupCommand(tc({ lockfiles: locks({ npm: true }) }))
    expect(cmd).toContain('npm ci')
    expect(cmd).toContain('|| npm install')
    // Parenthesised: callers join with ` && `, and `&&`/`||` bind left-to-right,
    // so an unwrapped fallback would take the whole preceding chain as its left
    // operand and install in the wrong directory.
    expect(cmd?.startsWith('(')).toBe(true)
    expect(cmd?.endsWith(')')).toBe(true)
  })

  it('never wraps an explicit override — a typed command keeps its own semantics', () => {
    expect(resolveSetupCommand(tc({ lockfiles: locks({ npm: true }) }), 'npm ci')).toBe('npm ci')
  })

  it('a config override wins — even with no package.json (non-JS bootstrap)', () => {
    expect(resolveSetupCommand(tc({ lockfiles: locks({ pnpm: true }) }), 'make deps')).toBe(
      'make deps',
    )
    expect(resolveSetupCommand(tc({ hasPackageJson: false }), 'make deps')).toBe('make deps')
    // whitespace-only override is treated as unset
    expect(resolveSetupCommand(tc({ hasPackageJson: false }), '   ')).toBeUndefined()
  })

  it('returns undefined for a repo with no JS toolchain and no override', () => {
    expect(resolveSetupCommand(tc({ hasPackageJson: false }))).toBeUndefined()
  })
})

describe('cacheMountFor — package-manager cache bind-mounts', () => {
  it('maps download-cache managers to their in-sandbox cache path', () => {
    expect(cacheMountFor('bun', '/host/bun')).toEqual({
      hostPath: '/host/bun',
      sandboxPath: '~/.bun/install/cache',
    })
    expect(cacheMountFor('yarn', '/host/yarn')).toEqual({
      hostPath: '/host/yarn',
      sandboxPath: '~/.cache/yarn',
    })
    expect(cacheMountFor('npm', '/host/npm')).toEqual({
      hostPath: '/host/npm',
      sandboxPath: '~/.npm',
    })
  })

  // pnpm's store is hardlink-based, and a bind mount is always a different
  // filesystem from the container's overlayfs — mounting it forces a full copy
  // of every package instead of linking, on every host OS. Better unmounted.
  it('returns undefined for pnpm so its store stays inside the container', () => {
    expect(cacheMountFor('pnpm', '/host/pnpm')).toBeUndefined()
  })
})

describe('burn workspace mode (ADR-0005 — keep the hot path off the mount)', () => {
  // `burnCache: 'off'` throughout: with the cache on the mode is always `slot`
  // and the platform stops mattering, which is its own describe below.
  const cfg = (
    sandbox: RuncastleConfig['sandbox'],
    burnWorkspace: RuncastleConfig['burnWorkspace'],
  ) => ({ sandbox, burnWorkspace, burnCache: 'off' as const })

  it('auto isolates on win32/darwin container hosts, stays mounted on linux', () => {
    expect(resolveBurnWorkspaceMode(cfg('docker', 'auto'), 'win32')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(cfg('docker', 'auto'), 'darwin')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(cfg('podman', 'auto'), 'win32')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(cfg('docker', 'auto'), 'linux')).toBe('mounted')
  })

  it('an explicit setting wins over the platform', () => {
    expect(resolveBurnWorkspaceMode(cfg('docker', 'isolated'), 'linux')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(cfg('docker', 'mounted'), 'win32')).toBe('mounted')
  })

  it('noSandbox is always mounted — no container, nothing to isolate from', () => {
    expect(resolveBurnWorkspaceMode(cfg('noSandbox', 'auto'), 'win32')).toBe('mounted')
    expect(resolveBurnWorkspaceMode(cfg('noSandbox', 'isolated'), 'win32')).toBe('mounted')
  })
})

describe('buildIsolatedSetupCommand — clone + auto-sync wiring for the sandbox hook', () => {
  const branch = 'runcastle/ticket/my-feature/4-ab12cd34'

  it('whitelists safe.directory, wires the clone and a post-commit push hook, then installs in the clone', () => {
    const cmd = buildIsolatedSetupCommand(branch, 'corepack pnpm install --frozen-lockfile')
    const steps = cmd.split(' && ')
    // Container-local wildcard: the worktree's gitdir resolves into the parent
    // .git mount, which sandcastle ≤0.12.0 leaves outside safe.directory —
    // without this the clone dies with "dubious ownership".
    expect(steps[0]).toBe(`git config --global --add safe.directory '*'`)
    expect(steps[1]).toBe(`git clone ${SANDBOX_WORKSPACE_PATH} ${ISOLATED_REPO_PATH}`)
    // the post-commit hook pushes HEAD to the ticket's temp branch (ref-only —
    // receive.denyCurrentBranch=ignore host-side) and then hard-resets the
    // mounted workspace checkout to it, so the worktree tracks the branch and
    // sandcastle's dirty check stays clean. Sync requires no agent discipline.
    // (Asserted on `cmd`, not a ' && '-split step: the hook body itself
    // contains ' && '.)
    expect(cmd).toContain(`HEAD:%s`)
    expect(cmd).toContain(`git -C ${SANDBOX_WORKSPACE_PATH} reset --hard --quiet %s`)
    // git exports GIT_DIR & co to hooks — without unsetting them the -C reset
    // would operate on the clone's repo, not the workspace
    expect(cmd).toContain('unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE')
    expect(cmd).toContain(`'${branch}' '${branch}'`)
    expect(cmd).toContain(`> ${ISOLATED_REPO_PATH}/.git/hooks/post-commit`)
    expect(cmd).toContain(`chmod +x ${ISOLATED_REPO_PATH}/.git/hooks/post-commit`)
    // install runs INSIDE the clone, on the container's native filesystem
    expect(cmd).toContain(`cd ${ISOLATED_REPO_PATH} && corepack pnpm install --frozen-lockfile`)
  })

  it('re-pins core.hooksPath to .git/hooks AFTER the install — husky must not disarm the sync hook', () => {
    // A husky `prepare` script run by the install sets core.hooksPath=.husky/_,
    // which makes git ignore .git/hooks/post-commit — commits then stay trapped
    // in the clone and the ticket fails "agent made no commits" despite
    // completed work (observed on a real burn). Last writer wins, so the
    // re-pin must be the final step.
    const cmd = buildIsolatedSetupCommand(branch, 'corepack pnpm install --frozen-lockfile', 'pnpm')
    const rePin = `git -C ${ISOLATED_REPO_PATH} config core.hooksPath ${ISOLATED_REPO_PATH}/.git/hooks`
    expect(cmd.endsWith(rePin)).toBe(true)
    expect(cmd.indexOf(rePin)).toBeGreaterThan(cmd.indexOf('install --frozen-lockfile'))
  })

  it('shims pnpm/yarn onto ~/.local/bin — only corepack ships in the image', () => {
    // Real-burn agents each independently rediscovered `pnpm: command not
    // found` and hand-wrote this exact shim; do it once in setup instead.
    const pnpmCmd = buildIsolatedSetupCommand(branch, 'corepack pnpm install', 'pnpm')
    expect(pnpmCmd).toContain(`printf '#!/bin/sh\\nexec corepack pnpm "$@"\\n' > "$HOME/.local/bin/pnpm"`)
    expect(pnpmCmd).toContain(`chmod +x "$HOME/.local/bin/pnpm"`)
    const yarnCmd = buildIsolatedSetupCommand(branch, 'corepack yarn install', 'yarn')
    expect(yarnCmd).toContain(`> "$HOME/.local/bin/yarn"`)
    // bun/npm binaries exist in the image already — no shim
    expect(buildIsolatedSetupCommand(branch, 'npm ci', 'npm')).not.toContain('.local/bin')
    expect(buildIsolatedSetupCommand(branch, 'bun install', 'bun')).not.toContain('.local/bin')
    expect(buildIsolatedSetupCommand(branch, undefined)).not.toContain('.local/bin')
  })

  it('does NOT write receive.denyCurrentBranch in-sandbox — that is a host-side, once-per-burn write', () => {
    // A worktree shares its parent repo's .git/config; N sandboxes running the
    // write concurrently race on the shared config.lock and kill setup. The
    // host writes it once via allowPushToCheckedOutBranches before tickets spawn.
    const cmd = buildIsolatedSetupCommand(branch, 'npm ci')
    expect(cmd).not.toContain('receive.denyCurrentBranch')
  })

  it('still emits the clone/sync wiring when there is nothing to install', () => {
    const cmd = buildIsolatedSetupCommand(branch, undefined)
    expect(cmd).toContain('git clone')
    expect(cmd).toContain('post-commit')
    expect(cmd).not.toContain(' cd ')
  })
})

describe('buildWorkspaceNotes — the {{WORKSPACE_NOTES}} prompt block', () => {
  it('mounted mode points at the current directory', () => {
    expect(buildWorkspaceNotes('mounted')).toContain('current directory')
  })

  it('isolated mode redirects work, forbids the mirror, and routes BLOCKED.md to both', () => {
    const notes = buildWorkspaceNotes('isolated')
    expect(notes).toContain(ISOLATED_REPO_PATH)
    expect(notes).toContain(SANDBOX_WORKSPACE_PATH)
    expect(notes).toContain('BLOCKED.md')
    expect(notes).toMatch(/never edit/i)
  })

  it('mounted mode puts DIGEST.md at the checkout root, uncommitted', () => {
    const notes = buildWorkspaceNotes('mounted')
    expect(notes).toContain('DIGEST.md')
    expect(notes).toMatch(/uncommitted/i)
  })

  it('isolated mode puts DIGEST.md in the mounted mirror, not the isolated clone', () => {
    const notes = buildWorkspaceNotes('isolated')
    expect(notes).toContain(`${SANDBOX_WORKSPACE_PATH}/DIGEST.md`)
    expect(notes).not.toContain(`${ISOLATED_REPO_PATH}/DIGEST.md`)
  })
})

describe('harvestDigest — reading the agent DIGEST.md off the workspace', () => {
  /** A throwaway dir, optionally holding a DIGEST.md with the given content. */
  function dirWithDigest(content?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'runcastle-digest-'))
    if (content !== undefined) writeFileSync(join(dir, 'DIGEST.md'), content, 'utf8')
    return dir
  }

  it('reads and trims the digest from the first candidate dir that has one', () => {
    const worktree = dirWithDigest('\n## What was done\nBuilt the thing.\n\n')
    expect(harvestDigest([worktree, dirWithDigest('the repo copy')])).toBe(
      '## What was done\nBuilt the thing.',
    )
  })

  it('falls back to a later candidate dir', () => {
    expect(harvestDigest([dirWithDigest(), dirWithDigest('from the repo')])).toBe('from the repo')
  })

  it('reads no digest when the agent wrote none', () => {
    expect(harvestDigest([dirWithDigest(), undefined])).toBeUndefined()
  })

  it('treats a whitespace-only digest as no digest', () => {
    expect(harvestDigest([dirWithDigest('  \n\t\n ')])).toBeUndefined()
  })
})

describe('composeRunDigest — the run-level aggregate (mechanical, no LLM)', () => {
  it('concatenates one section per ticket, in seq order', () => {
    expect(
      composeRunDigest([
        { seq: 2, title: 'Second thing', digest: 'Wired the second seam.' },
        { seq: 1, title: 'First thing', digest: 'Wired the first seam.' },
      ]),
    ).toBe(
      '## ticket 1 — First thing\n\nWired the first seam.\n\n' +
        '## ticket 2 — Second thing\n\nWired the second seam.',
    )
  })

  it('composes null when the run harvested nothing', () => {
    expect(composeRunDigest([])).toBeNull()
  })

  it('keeps a multi-line digest body intact under its header', () => {
    expect(
      composeRunDigest([
        { seq: 7, title: 'Only thing', digest: '\nDid it.\n\nSurprise: the column existed.\n' },
      ]),
    ).toBe('## ticket 7 — Only thing\n\nDid it.\n\nSurprise: the column existed.')
  })
})

describe('createSerialQueue — one task at a time, in order', () => {
  it('runs tasks strictly serially in submission order', async () => {
    const queue = createSerialQueue()
    const log: string[] = []
    let active = 0

    const task = (name: string, delay: number) => async () => {
      active += 1
      expect(active).toBe(1) // never overlaps
      log.push(`start ${name}`)
      await new Promise((r) => setTimeout(r, delay))
      log.push(`end ${name}`)
      active -= 1
      return name
    }

    // Submit concurrently; the slow first task must fully finish before the fast second starts.
    const [a, b, c] = await Promise.all([
      queue(task('a', 20)),
      queue(task('b', 1)),
      queue(task('c', 1)),
    ])

    expect([a, b, c]).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('a rejection reaches its submitter without wedging later tasks', async () => {
    const queue = createSerialQueue()

    const failing = queue(async () => {
      throw new Error('merge failed')
    })
    const after = queue(async () => 'still runs')

    await expect(failing).rejects.toThrow('merge failed')
    await expect(after).resolves.toBe('still runs')
  })
})

describe('landWithResolve — conflicts are resolved in-loop, not handed to the human', () => {
  /** A `LandDeps` whose merge/resolve behaviour is scripted per call. */
  function deps(
    merges: TempBranchMergeResult[],
    resolves: ResolveAttemptResult[],
    maxResolveAttempts = 2,
  ) {
    const events: { type: string; message: string; data?: unknown }[] = []
    const merged: string[] = []
    const resolved: { branch: string; files: string[]; attempt: number }[] = []
    const landDeps: LandDeps = {
      merge: (branch) => {
        merged.push(branch)
        return Promise.resolve(merges[merged.length - 1] ?? { ok: false, error: 'unscripted merge' })
      },
      resolve: (input) => {
        resolved.push({ branch: input.branch, files: input.files, attempt: input.attempt })
        return Promise.resolve(
          resolves[resolved.length - 1] ?? { ok: false, branch: input.branch, error: 'unscripted' },
        )
      },
      maxResolveAttempts,
      emit: (e) => events.push(e),
      label: 'ticket 3',
      featureBranch: 'feature/demo',
    }
    return { landDeps, events, merged, resolved }
  }

  it('lands directly when the merge is clean — no resolver agent is spawned', async () => {
    const d = deps([{ ok: true }], [])
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'landed', branch: 'tkt/3-a' })
    expect(d.resolved).toEqual([])
    expect(d.events).toEqual([])
  })

  it('resolves a conflict and lands the resolver’s branch', async () => {
    const d = deps(
      [{ ok: false, conflict: true, files: ['a.ts', 'b.ts'], error: 'CONFLICTS: a.ts, b.ts' }, { ok: true }],
      [{ ok: true, branch: 'tkt/3-resolved' }],
    )
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'landed', branch: 'tkt/3-resolved' })
    // the resolver was briefed with the conflicting files git reported…
    expect(d.resolved).toEqual([{ branch: 'tkt/3-a', files: ['a.ts', 'b.ts'], attempt: 1 }])
    // …and the SECOND merge lands the resolved branch, not the original
    expect(d.merged).toEqual(['tkt/3-a', 'tkt/3-resolved'])
    expect(d.events.map((e) => e.type)).toEqual([
      'merge.conflict.resolving',
      'merge.conflict.resolved',
    ])
  })

  it('loops when the feature tip moves again mid-resolve, up to the attempt budget', async () => {
    const d = deps(
      [
        { ok: false, conflict: true, files: ['a.ts'], error: 'c1' },
        { ok: false, conflict: true, files: ['c.ts'], error: 'c2' },
        { ok: true },
      ],
      [
        { ok: true, branch: 'tkt/3-r1' },
        { ok: true, branch: 'tkt/3-r2' },
      ],
    )
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'landed', branch: 'tkt/3-r2' })
    // each pass re-reads the CURRENT conflict rather than reusing the first list
    expect(d.resolved).toEqual([
      { branch: 'tkt/3-a', files: ['a.ts'], attempt: 1 },
      { branch: 'tkt/3-r1', files: ['c.ts'], attempt: 2 },
    ])
  })

  it('gives up for a human once the budget is spent, reporting the live conflict', async () => {
    const d = deps(
      [
        { ok: false, conflict: true, files: ['a.ts'], error: 'c1' },
        { ok: false, conflict: true, files: ['a.ts', 'd.ts'], error: 'c2' },
      ],
      [{ ok: true, branch: 'tkt/3-r1' }],
      1,
    )
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    // the branch carried forward is the resolver's (it holds the most work) and
    // the files are the ones that STILL conflict, not the original list
    expect(out).toEqual({
      status: 'conflict',
      branch: 'tkt/3-r1',
      files: ['a.ts', 'd.ts'],
      error: 'c2',
    })
  })

  it('a resolver that fails still carries its branch forward, with its own error', async () => {
    const d = deps(
      [{ ok: false, conflict: true, files: ['a.ts'], error: 'c1' }],
      [{ ok: false, branch: 'tkt/3-r1', error: 'resolver reported BLOCKED:\ncontradictory specs' }],
    )
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({
      status: 'conflict',
      branch: 'tkt/3-r1',
      files: ['a.ts'],
      error: 'resolver reported BLOCKED:\ncontradictory specs',
    })
    expect(d.merged).toEqual(['tkt/3-a']) // no second merge after a failed resolve
  })

  it('never resolves when the budget is 0 (resolver disabled)', async () => {
    const d = deps([{ ok: false, conflict: true, files: ['a.ts'], error: 'c1' }], [], 0)
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'conflict', branch: 'tkt/3-a', files: ['a.ts'], error: 'c1' })
    expect(d.resolved).toEqual([])
  })

  it('a non-conflict landing failure is never handed to a resolver', async () => {
    const d = deps([{ ok: false, error: 'could not lock ref' }], [])
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'failed', branch: 'tkt/3-a', error: 'could not lock ref' })
    expect(d.resolved).toEqual([])
  })
})

describe('resolver prompt blocks', () => {
  it('renders the conflicting files, falling back to a git instruction', () => {
    expect(buildConflictFilesBlock(['src/a.ts', 'src/b.ts'])).toBe('- `src/a.ts`\n- `src/b.ts`')
    expect(buildConflictFilesBlock([])).toMatch(/git status/)
  })

  it('renders the other side of the merge, falling back to a git instruction', () => {
    expect(buildOtherSideBlock(['abc1234 ticket(2): add staging', 'def5678 ticket(4): wire it'])).toBe(
      '- abc1234 ticket(2): add staging\n- def5678 ticket(4): wire it',
    )
    expect(buildOtherSideBlock([])).toMatch(/git log/)
  })

  it('names the feature branch directly when mounted, and via a fetch when isolated', () => {
    // isolated mode works in a container-native CLONE, where the feature branch
    // is only a remote ref — a bare `git merge feature/x` would fail there
    expect(resolveMergeCommand('mounted', 'feature/x')).toBe('git merge --no-edit feature/x')
    expect(resolveMergeCommand('isolated', 'feature/x')).toBe(
      'git fetch origin feature/x && git merge --no-edit FETCH_HEAD',
    )
  })

  it('renderTemplate leaves placeholders it was given no value for alone', () => {
    expect(renderTemplate('{{A}} and {{B}} and {{A}}', { A: 'x' })).toBe('x and {{B}} and x')
  })
})
