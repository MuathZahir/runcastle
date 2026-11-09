import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * The orchestrator's behaviour is skill text, pinned the way `self-plan-skill.test`
 * pins planning without a human: read the shipped files and assert their wording.
 * The orchestrating briefing names the section by its heading, so the heading is
 * load-bearing, and the tool names must match the tools the server registers.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(resolvePluginDir(), 'skills', ...parts), 'utf8')

const PROJECT_TOOLS = [
  'get_project_context',
  'read_adr',
  'read_feature_brief',
  'get_work_record',
  'create_feature',
  'set_feature_dependencies',
  'record_event',
  'list_project_notes',
  'triage_project_note',
  'update_project_note',
  'get_feature_context',
  'read_feature_doc',
  'start_feature',
  'plan_feature',
  'send_to_feature',
  'read_feature_chat',
  'stop_feature_run',
  'drive',
  'merge_feature',
  'add_to_brief',
  'take_feature',
  'record_finding',
  'dry_run_drive',
]

describe('the project skill, orchestrating', () => {
  const skill = (): string => read('project', 'SKILL.md')
  const section = (): string => {
    const text = skill()
    const at = text.search(/^## Orchestrating$/m)
    expect(at).toBeGreaterThanOrEqual(0)
    return text.slice(at, text.indexOf('\n## ', at + 1))
  }

  it('is always in force, with nothing making it conditional', () => {
    const text = skill()
    const top = text.slice(0, text.indexOf('## 0.'))
    expect(top).toContain("**You are also always this project's orchestrator.**")
    expect(section()).toContain('This is standing guidance')
    expect(text).not.toMatch(/when your briefing says you are the orchestrator|applies only (then|when)/i)
    expect(text).not.toMatch(/setting|experimental|turns? the mode/i)
  })

  // Decision 10: the main file rides every orchestrator call, so it keeps only
  // what every turn needs and points at a reference per job.
  it('keeps only what every turn needs, with a reference per job that exists', () => {
    const text = skill()
    expect(text.length).toBeLessThanOrEqual(25_000)
    expect(text).not.toContain('## Your tools')
    expect(text).toContain('**Load your runcastle tools once**')
    const pointers = [...text.matchAll(/\.\/references\/([a-z-]+\.md)/g)].map((m) => m[1])
    expect(pointers).toEqual(expect.arrayContaining(['intake.md', 'routing.md', 'charter.md', 'health-sweeps.md', 'triage.md', 'preparation.md']))
    for (const file of pointers) expect(existsSync(join(resolvePluginDir(), 'skills', 'project', 'references', file)), file).toBe(true)
    expect(read('project', 'references', 'intake.md')).toContain('### 1c. Create — once the split is agreed')
    expect(read('project', 'references', 'routing.md')).toContain('## 4. Curation — advisory only')
  })

  it('names every tool the orchestrator has across the skill and its references, and none it lost', () => {
    const text = ['SKILL.md', ...readdirSync(join(resolvePluginDir(), 'skills', 'project', 'references'))]
      .map((f) => (f === 'SKILL.md' ? read('project', f) : read('project', 'references', f)))
      .join('\n')
    for (const tool of PROJECT_TOOLS) expect(text, tool).toMatch(new RegExp(`\\b${tool}\\b`))
    expect(text).not.toMatch(/take_over_feature|record_test_note|complete_phase/)
  })

  it('asks the two questions at intake, and reads the finish from the feature while orchestrating', () => {
    const intake = read('project', 'references', 'intake.md')
    const questions = intake.slice(intake.indexOf('## Two questions per cut'), intake.indexOf('## The planning choice'))
    expect(questions).toContain('**Before you create anything for a cut, ask the human two plain questions')
    expect(questions).toContain('Plan it with me')
    expect(questions).toContain('plan it yourself and show me')
    expect(questions).toContain('I finish it')
    expect(questions).toContain('you build it and show me before merging')
    expect(questions).toContain('you build and merge it')
    expect(questions).toContain("`planning: 'with-me' | 'self'`")
    expect(questions).toContain("`finish: 'you' | 'show' | 'merge'`")
    expect(questions).toContain('They are not written into briefs.')
    expect(questions).toContain('**Every new request is a new cut**')
    const text = section()
    const at = text.indexOf('### How far you take each feature')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at).toBeLessThan(text.indexOf('### Grill, create, plan, start'))
    expect(text).toContain('Read it there (`get_feature_context`, `get_project_context`), never from the brief.')
    expect(text).toContain('**`show`** ("you build it and show me before merging")')
    expect(text).toContain('**`merge`** ("you build and merge it")')
    expect(text).toContain('designs are approved only by the human, never by you')
    expect(text).toContain('**Outside a cut, merge only when the human asks you to.**')
    expect(text).toContain('**When you ask the human about a feature you own, show its card in the same turn**')
    expect(text).toContain('`show_plan({ slug })`')
    expect(text).toContain('Never show a raw `preview.html`.')
    expect(text).toContain('**Drive when a "show me before merging" feature is ready**')
    expect(text).toContain('**You never start a worker or a review**')
  })

  it('has no working agreements, checkpoints or check-ins left', () => {
    for (const f of ['SKILL.md', join('references', 'intake.md')]) {
      const text = read('project', ...f.split(/[\\/]/))
      expect(text, f).not.toMatch(/working agreement/i)
      expect(text, f).not.toMatch(/checkpoint/i)
      expect(text, f).not.toMatch(/check-in/i)
    }
  })

  it('recommends a planning choice per feature at the cut, and leaves a plan-with-me feature to the human', () => {
    const intake = read('project', 'references', 'intake.md')
    expect(intake).toContain('- **Give every feature a planning choice.**')
    const mode = intake.slice(intake.indexOf('## The planning choice'))
    expect(mode).toContain('**Every feature in a cut proposal shows how it is planned, with a one-line reason**')
    expect(mode).not.toContain('- **Grilled here**')
    expect(mode).toContain('A small, nearly concrete one you may grill here first')
    expect(mode).toContain('- **Plan it with me**')
    expect(mode).toContain('- **Plan it yourself and show me**')
    expect(mode).toContain('**Recommend the grill** when the feature decides how something new works or looks')
    expect(mode).toContain('small visible tweaks to something that already exists')
    expect(mode).toContain('**When unsure, recommend the grill**')
    expect(mode).toMatch(/^- Plan it with me: /m)
    expect(mode).toMatch(/^- Plan it yourself: /m)
    expect(mode).toContain('**Never call `plan_feature` on it, and never give its plan the yes yourself.**')
    expect(mode).toContain('which you relay (`send_to_feature` with `relaysHuman: true`)')
    expect(mode).toContain('**Hand the human its chat.**')
    expect(mode).toContain('`notify_human` once')
    expect(mode).toContain('There is no fallback')
    expect(mode).toContain('**At the human\'s plan yes, if its finish is show or merge, its lead hands it to you and it becomes yours.**')
    const text = section()
    expect(text).toContain('**A "plan it with me" feature never plans itself, and its plan\'s yes is the human\'s**')
    expect(text).toContain('relay their own yes with `relaysHuman: true`')
    expect(text).toContain('never a grill feature\'s plan')
    expect(text).toContain('a "plan it with me" one waits for the human\'s chat')
    // the-status-tells-the-truth 7, 8: a self-planned plan's yes arrives as a handback,
    // and the feature reads "With <chat>" until the orchestrator acts.
    const flatText = read('project', 'SKILL.md').replace(/\s+/g, ' ')
    expect(flatText).toContain('a feature that plans itself asks for it with a handback')
    expect(flatText).toContain('it reads "With <your chat\'s name>" in the human\'s Working lane')
    expect(text).not.toContain('With the orchestrator')
    expect(text).toContain('owners and finish choices from `get_project_context` and `get_feature_context`, the briefs for intent')
  })

  // The human, 2026-11-06: "I want to explore each decision and each branch of the
  // tree when we're grilling", and a yes to a message is not a yes to everything in it.
  it('grills one decision at a time, walks every branch, and takes a yes for the one question asked', () => {
    const intake = read('project', 'references', 'intake.md')
    const grill = intake.slice(intake.indexOf('## How you grill'), intake.indexOf('## Where each feature is grilled'))
    expect(grill).toContain('**One decision per question.**')
    expect(grill).toContain('**Walk every branch of the decision tree.**')
    expect(grill).toContain('**Never put a decision inside a paragraph**')
    expect(grill).toContain('**An answer settles only the question it answers.**')
    const where = intake.slice(intake.indexOf('## Where each feature is grilled'))
    expect(where).toContain('**Small and nearly concrete**')
    expect(where).toContain('**grill it here**, to the end, before you create it')
    expect(where).toContain('`## Decided with the human`')
    expect(intake).toContain('each decision that changes what the human gets is theirs')
    expect(intake).toContain('**The cut is features and their boundaries, nothing more**')
    expect(skill()).toContain('**Never decide for the human.**')
    expect(read('feature', 'references', 'planning-alone.md')).toContain('- **For the human.** Every decision that changes what the human gets')
  })

  it('acts only on what the human asked, as far as they asked, or on a feature it owns', () => {
    const text = section()
    expect(text).toContain(
      '**Act only on what the human asked in this conversation, as far as they asked, or on a feature you own, as far as its finish choice goes.**',
    )
    expect(text).toContain('"Check on X" is a read, not a licence to start X')
    expect(text).toContain('**Questions, portfolio answers and health sweeps never lead to action on their own**')
    expect(text).toContain("**A feature the human is running by hand is theirs** unless they ask you to act on it")
    expect(text).toContain("**No limits beyond the human's buttons and ownership**")
  })

  it('stops when told, saying what is still in flight, and when the orchestrator chat ends', () => {
    const text = section()
    expect(text).toContain('**When the human tells you to stop, start nothing new**')
    expect(text).toContain('tell them what is still in flight')
    expect(text).toContain('Ending the orchestrator chat does not stop you for good')
  })


  it('puts a shared thing in one place, and says so before departing from the literal ask', () => {
    const text = section()
    expect(text).toContain(
      '**When several features would change the same shared thing — a theme, a component, a schema — the change belongs in one place**',
    )
    expect(text).toContain('agents editing the same files apart conflict and drift')
    expect(text).toContain('Work out per task what that place is')
    expect(text).toContain('**When that means doing something other than what the human literally said, say so before you act**')
    expect(text).toContain('go ahead unless they object')
    expect(text).toContain('**When the human judges one part, tell them what they are looking at.**')
    expect(text).toContain('order the work so shared pieces merge first')
  })

  it('gathers interruptions and weighs machine cost', () => {
    const text = section()
    expect(text).toContain('**Gather what needs the human into one message**')
    expect(text).toContain('unless one item blocks everything else')
    expect(text).toContain('**Every feature you set working costs machine time**')
    expect(text).toContain('Start only as many at once as the work gains from.')
  })

  it("talks to a feature's agent both ways, and leaves a busy feature alone", () => {
    const text = section()
    expect(text).toContain("it is from the project's orchestrator")
    expect(text).toContain("**When you pass on the human's own answer, set `relaysHuman: true`**")
    expect(text).toContain('**`read_feature_chat({ slug })`**')
    expect(text).toContain("**A feature is busy while the human is using its chat**")
    expect(text).toContain('within about the last 30 minutes (`humanTypedAt` in `get_feature_context`)')
    expect(text).toContain('or its agent is mid-turn on their message')
    expect(text).toContain('wait until it is free, or tell the human what you want to send')
    expect(text).toContain('**A feature the human stepped into stays in the cut.**')
    expect(text).toContain('treat what they told that agent as their decision')
  })

  it('guards its context with cheaper subagents on both CLIs', () => {
    const text = section()
    expect(text).toContain('the Agent tool with `model: "sonnet"`')
    expect(text).toContain('`spawn_agent` with a smaller model if it accepts one')
    expect(text).toContain("**Do not go into a feature's details unless something needs it**")
    expect(text).toContain("reorient from runcastle's record, not from memory")
  })

  // The human, 2026-11-06: "I don't want you to make decisions on my behalf and lay
  // them down in a paragraph." Every decision that changes what they get is theirs,
  // under every finish; only how it is built is the orchestrator's.
  it('puts every decision that changes what the human gets to them, one question at a time', () => {
    const text = section()
    expect(text).toContain('**A decision that changes what the human gets is theirs, under every finish**')
    expect(text).toContain('`**For the human.**`')
    expect(text).toContain('Building runs on its own; their decisions never do.')
    expect(text).not.toContain('a wrong guess would cost a round')
    expect(text).toContain('**One question at a time**')
    expect(text).toContain('**Keep everything else moving while you wait**')
    expect(text).toContain("saying it is the human's answer")
  })

  it('owns only what the human gave it, and takes a feature only on their words', () => {
    const text = section()
    expect(text).toContain('### Owning')
    expect(text).not.toContain('### Holding')
    expect(text).toContain('**You own only the features the human gave you**')
    expect(text).toContain('`take_feature({ slug, finish })`')
    expect(text).toContain('Acting on a feature does not make it yours.')
    expect(text).toContain('**You hear about the features you own**')
    expect(text).toContain('**On a feature the human owns, you may read it and `send_to_feature` only**')
    expect(text).toContain('**When the human takes a feature**')
    expect(text).toContain('take it only on their words')
    expect(text).toContain('`[runcastle]`')
    // A feature speaks by its lead's handback; runcastle's lines are the orchestrator's own work (agents-are-woken-only-when-it-matters 21, 23).
    expect(text).toContain("**A lead's handback** is how a feature tells you something")
    expect(text).toContain('are about your own work only')
    expect(text).not.toContain('For its next turn')
    expect(text).not.toContain('Since you were last live')
    expect(text).toContain('The app shows the owner on each feature\'s header and sidebar row.')
  })

  it("merges through runcastle and never works in a live session's worktree", () => {
    const text = section()
    expect(text).toContain('**Merge through runcastle**: `merge_feature`')
    expect(text).toContain("**Never work in a feature's worktree while that feature has a live session.**")
    expect(text).toContain('**`decisions.md` is the record**')
  })
})

/**
 * The orchestrator prepares the project itself (decisions 3, 5, 8): §0 reads
 * the start note's three facts, and the method lives in a reference loaded
 * only when preparation is due.
 */
describe('the project skill, preparing', () => {
  const opening = (): string => {
    const text = read('project', 'SKILL.md')
    const at = text.indexOf('## 0. Open by asking')
    expect(at).toBeGreaterThanOrEqual(0)
    return text.slice(at, text.indexOf('\n## 1.', at))
  }
  const reference = (): string => read('project', 'references', 'preparation.md')

  it('prepares first only on a new project with code and open keys, and offers in one line otherwise', () => {
    const text = opening()
    expect(text).toContain('**The repo has code, keys are open, and no feature ever**')
    expect(text).toContain('read `./references/preparation.md` and prepare the project')
    expect(text).toContain('Ask what we are building only after')
    expect(text).toContain('**The repo has code, keys are open, and the project has had features**')
    expect(text).toContain('with one line offering to set up what is open')
    expect(text).toContain('**An empty repo, or nothing open** — open by asking')
  })

  // The human's verdict on the onboarding drive (decision 17): a first chat that
  // said "preparation", "all eight settings are closed" and "the whole gate"
  // left a new user with no idea what was happening.
  it('talks to a new user about their app, in plain words, and closes with what they can do', () => {
    expect(opening()).toContain('**Talk about their app, never about runcastle**')
    const text = reference()
    expect(text).toContain('## Talking to someone new')
    expect(text).toContain('**Lead with their app.**')
    expect(text).toContain('**Plain words, always.**')
    expect(text).toContain('**Close with what they can now do, not the list.**')
    expect(text).toContain('Settings › This project')
    expect(text).not.toContain('one line telling the human that ＋ New scenario')
  })

  it('loads the preparation method on demand, beside the other procedures', () => {
    expect(opening()).toContain('`./references/preparation.md`')
    expect(reference()).toContain('`./preparation-recipes.md`')
    expect(read('project', 'references', 'preparation-recipes.md')).toContain('## Postgres, one database per drive')
  })

  it('carries the method rewritten for the orchestrator', () => {
    const text = reference()
    // Landing: written in its worktree, landed by the dry run's start, refusals relayed.
    expect(text).toContain('in your worktree and commit it')
    expect(text).toContain('lands your commits on the base branch first')
    expect(text).toContain('ask them to switch branch or commit their edits')
    // None, later, can't-finish, ask only what it cannot find.
    expect(text).toContain('recorded as a "none"')
    expect(text).toContain('**"Later" means later.**')
    expect(text).toContain('**A key you cannot settle stays open.**')
    expect(text).toContain('**Ask only what you cannot find**')
    expect(text).toContain('**Ask before you act.**')
    // Nothing left of the preparation session's own exception.
    expect(text).not.toMatch(/preparation session|a hook enforces it/)
  })
})

describe('the project skill, with no Go, no quick changes and no missing tools', () => {
  const texts = (): string[] =>
    ['references/routing.md', 'SKILL.md', 'references/intake.md', 'references/triage.md', 'references/health-sweeps.md'].map(
      (f) => read('project', ...f.split('/')),
    )

  it('mentions neither Go, go_feature nor a quick change', () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/\bGo\b/)
      expect(text).not.toMatch(/go_feature|quick[ -]change/i)
      expect(text).not.toMatch(/create_feature\(\{[^}]*tickets/)
    }
  })

  it('speaks of workers, never of phases, laps or burns', () => {
    for (const text of texts()) expect(text).not.toMatch(/\b(phases?|laps?|burn\w*)\b/i)
  })

  it('never says it cannot launch, message or act on a feature', () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/never launch|no tool for|have no tool|tell the human to open/i)
    }
  })

  it("creates a feature with a brief, and has its own agent ask the human for the yes", () => {
    const text = texts()[0]
    expect(text).toContain('`create_feature({ title, oneLiner, brief })`')
    expect(text).toContain('asks the human for the yes in its chat')
  })
})

describe('the feature skill and the orchestrator', () => {
  const text = (): string => read('feature', 'references', 'grilling.md')

  it("recognises an orchestrator message by its opening line, and a relayed human answer", () => {
    const relay = read('feature', 'SKILL.md')
    expect(relay).toContain("a message that opens with a line saying it is from the project's orchestrator")
    expect(relay).toContain("relays the human's own answer, treat it as the human confirming")
  })

  it('marks a change made on the orchestrator\'s message, and clears it for a relayed human answer', () => {
    const at = text().indexOf("**A change on the orchestrator's message is not the human's.**")
    expect(at).toBeGreaterThanOrEqual(0)
    const docs = text().slice(at, text().indexOf('\n\n', at))
    expect(docs).toContain("open with a line saying they are from the project's\norchestrator")
    expect(docs).toContain('`**Changed by the orchestrator:** <why>`')
    expect(docs).toContain('keeps its\n`**Assumed.**` line, or gains one')
    expect(docs).toContain("relays the human's own answer is the human confirming")
  })
})

describe('the deleted skills', () => {
  const skillsDir = join(resolvePluginDir(), 'skills')
  const DELETED = '(ideate|lead|spec|tickets|revisit|design)'

  it('leave the pack with feature, qa, project and code-review', () => {
    expect(readdirSync(skillsDir).sort()).toEqual(['code-review', 'feature', 'project', 'qa'])
  })

  it('are named by no remaining skill text', () => {
    const reference = new RegExp(
      `runcastle:${DELETED}\\b|\\$${DELETED}\\b|\\b${DELETED}/(SKILL\\.md|references)|\\.\\./${DELETED}/`,
    )
    const files = readdirSync(skillsDir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(md|html)$/.test(f))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      expect(readFileSync(join(skillsDir, file), 'utf8'), file).not.toMatch(reference)
    }
  })
})
