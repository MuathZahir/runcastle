import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EPIC_ICON_IDS } from '@runcastle/core'
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
  'set_autopilot',
  'name_epic',
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
    // The human's "carry on after a usage limit" setting is named on autopilot; no setting gates orchestrating.
    expect(text).not.toMatch(/orchestrat\w* setting|setting turns|experimental|turns? the mode/i)
  })

  // Decision 10: the main file rides every orchestrator call, so it keeps only
  // what every turn needs and points at a reference per job.
  it('keeps only what every turn needs, with a reference per job that exists', () => {
    const text = skill()
    // Raised from 25_000 for the epic icon ids name_epic picks from (epics-that-look-alive decision 1),
    // then from 25_400 for the never-guess statement every agent carries word for word (agents-never-guess decision 12),
    // then from 26_700 for the merge line every epic acts on (the-epic-hears-when-its-features-merge decisions 3, 11),
    // then from 27_300 for autopilot's run plan and hard limits (epics-on-autopilot).
    expect(text.length).toBeLessThanOrEqual(28_000)
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
    expect(text).not.toMatch(/take_over_feature|take_feature|record_test_note|complete_phase/)
  })

  it('names its epic on its first reply, never over the human, and suggests a new epic for a drifting request', () => {
    const top = skill().slice(0, skill().indexOf('## 0.'))
    expect(top).toContain('**This chat is an epic: name it.** In your first reply, call `name_epic` with 1–3 words, Title Case, a noun phrase')
    expect(top).toContain('name it on your next reply')
    expect(top).toContain("never over the human's rename")
    expect(top).toContain('suggest starting a new epic')
    expect(top).toContain('this chat is "the epic"')
  })

  it('picks an icon with the name, from the curated ids only, and lists every one (epics-that-look-alive decision 1)', () => {
    const top = skill().slice(0, skill().indexOf('## 0.'))
    expect(top).toContain('**Pick an icon with it**')
    expect(top).toContain('from this list only')
    for (const id of EPIC_ICON_IDS) expect(top, id).toMatch(new RegExp(`[ :]${id}[,.]`))
    expect(top).toContain('An icon the human picked is kept')
  })

  // epics-on-autopilot: one question per feature, two answers; running the features is autopilot, after the cut.
  it('asks one two-answer question per feature at intake, and leaves running them to autopilot', () => {
    const intake = read('project', 'references', 'intake.md')
    const at0 = intake.indexOf('## One question per feature')
    expect(at0).toBeGreaterThanOrEqual(0)
    const questions = intake.slice(at0, intake.indexOf('\n## ', at0 + 1))
    expect(intake).not.toMatch(/two (plain )?questions/i)
    expect(questions).toContain('**Before you create anything for a cut, ask the human one plain question per feature')
    expect(questions).toContain('It has two answers:')
    expect(questions).toContain("- **Plan it with me**: they grill it with its lead, in the feature's own chat (`planning: 'with-me'`).")
    expect(questions).toContain("- **Plan automatically**: it plans without them and shows them the plan in its chat, for their yes (`planning: 'self'`).")
    expect(questions).not.toMatch(/Run it for me|`finish:/)
    expect(questions).toContain("Pass the answer to `create_feature` as `planning: 'with-me' | 'self'`. It is not written into briefs.")
    expect(questions).toContain('Running the features for the human is not a cut answer: it is autopilot, proposed after the cut as a run plan')
    expect(questions).toContain('**Every new request is a new cut**')
    const text = section()
    const at = text.indexOf('### Autopilot')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at).toBeLessThan(text.indexOf('### Grill, create, plan, start'))
    expect(text).not.toContain('### How far you take each feature')
    expect(text).toContain('designs are approved only by the human, unless they handed you their decisions on autopilot')
    expect(text).toContain('**Merge only as far as the human said.**')
    expect(text).toContain('**When you ask the human about a locked feature, show its card in the same turn and put your question in words with a question mark**')
    expect(text).toContain('`show_plan({ slug })`')
    expect(text).toContain('Never show a raw `preview.html`.')
    expect(text).toContain('**You never start a worker or a review**')
  })

  // one-place-to-answer 5, 12: one end report, a drive started for "show me first", a plain yes merges here.
  it('ends a batch it runs with one report, a first drive and "merge these?"', () => {
    const text = section().replace(/\s+/g, ' ')
    expect(text).toContain('**End the batch with one report**')
    expect(text).toContain('**start the first drive** and say what to try')
    expect(text).toContain('Then ask "merge these?". A plain yes means you merge them.')
    expect(text).toContain('With decisions handed over, the report carries the one summary (**Autopilot**).')
    expect(text).toContain("The For-the-human decisions and designs need the human's own answer, relayed, unless they handed you their decisions.")
  })

  // one-place-to-answer 3, 15: never restate a feature's question; name each item's one place.
  it('points the human to a feature\'s chat, and names each waiting item\'s one place', () => {
    const text = section().replace(/\s+/g, ' ')
    expect(text).toContain("About a feature of the human's, never ask them anything, never restate its question, and never pass their words on: point them to its chat")
    expect(text).toContain('**"What\'s waiting for me?"** List each item with its one place, and never restate or answer a feature\'s question')
    expect(text).toContain('a feature of the human\'s, "answer in its chat"; something waiting in this epic, "answer here"; something waiting in another epic, "in <that epic>"')
  })

  // epics-on-autopilot decisions 1, 14: one switch per epic, on the human's own words, locking every open feature.
  it("turns autopilot on only on the human's words, after a run plan, and locks the whole epic", () => {
    const text = section().replace(/\s+/g, ' ')
    expect(text).toContain("**Every feature is the human's by default**")
    expect(text).toContain("**Autopilot is one switch for this epic, turned on only on the human's own words**")
    expect(text).toContain('Then propose a **run plan**')
    expect(text).toContain('On their yes, call `set_autopilot({ action: "on" })`: every open feature of this epic locks.')
    expect(text).toContain('"Also run X" is `set_autopilot({ action: "add", features: ["x"] })`, which moves X into this epic; "stop" is `"off"`.')
    expect(text).toContain('To work on one feature themselves, the human ends autopilot.')
    expect(text).toContain('**"I\'ll do X myself"** on autopilot: X stays locked until autopilot ends.')
    expect(text).not.toMatch(/take_feature|action: "remove"/)
  })

  it('answers for the human only when they handed over their decisions, and never past the hard limits', () => {
    const text = section().replace(/\s+/g, ' ')
    expect(text).toContain('**When the human hands you their decisions**')
    expect(text).toContain('`**Decided by autopilot.**`')
    expect(text).toContain('**Even then, hard limits hold: stop and `wait_for_you`**')
    expect(text).toContain('Agent usage is never a limit.')
    expect(text).toContain('relay their answer with `send_to_feature`, marked as their own words')
  })

  // one-place-to-answer 16: it may start the planning run of a "Plan automatically" feature it cut, once.
  it('may start a "Plan automatically" feature off autopilot, once, and nothing else on it', () => {
    const text = section().replace(/\s+/g, ' ')
    expect(text).toContain('**A "Plan automatically" feature off autopilot you may start once**, when the cut\'s order says it is its turn: `start_feature`, then `plan_feature`. It stays theirs')
    expect(text).toContain('Nothing else on their features.')
  })

  // one-place-to-answer 11: the old relay's names are gone from the whole pack. Relaying the
  // human's own answer is back, on autopilot only (epics-on-autopilot).
  it('names no relaysHuman, planAgreed or "Yours to plan" anywhere in the pack', () => {
    const root = join(resolvePluginDir(), 'skills')
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8')
      expect(text, f).not.toMatch(/relaysHuman|planAgreed|Yours to plan/)
    }
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
    expect(intake).toContain('- **Give every feature its cut answer.**')
    const mode = intake.slice(intake.indexOf('## One question per feature'))
    expect(mode).toContain('with your recommendation and a one-line reason**')
    expect(mode).not.toContain('- **Grilled here**')
    expect(mode).toContain('A small, nearly concrete one you may grill here first')
    expect(mode).toContain('- **Plan it with me**')
    expect(mode).toContain('- **Plan automatically**')
    expect(mode).toContain('**Offer Plan automatically only for a feature whose what, where and who are settled.**')
    expect(mode).not.toMatch(/plan it yourself/i)
    expect(mode).toContain('**Recommend the grill** when the feature decides how something new works or looks')
    expect(mode).toContain('small visible tweaks to something that already exists')
    expect(mode).toContain('**When unsure, recommend the grill**')
    expect(mode).toContain('**When the human wants it done while they are away**, that is autopilot, after the cut.')
    expect(mode).toMatch(/^- Plan it with me: /m)
    expect(mode).toMatch(/^- Plan automatically: /m)
    expect(mode).toContain('**Never call `plan_feature` on it, and never give its plan the yes yourself.**')
    expect(mode).toContain("It is the human's: they grill it in its chat and give the yes there. When they tell you about it here, point them to its chat.")
    expect(mode).toContain('**Hand the human its chat.**')
    expect(mode).toContain('`notify_human` once')
    expect(mode).toContain('There is no fallback')
    expect(mode).not.toContain('its lead hands it to you')
    const text = section()
    expect(text).toContain('**A "plan it with me" feature never plans automatically, and its plan\'s yes is the human\'s**')
    expect(text).not.toContain('never a grill feature\'s plan')
    expect(text).toContain("one of the human's waits for them")
    // the-status-tells-the-truth 7: a self-planned plan's yes arrives as a handback, from a locked feature only.
    const flatText = read('project', 'SKILL.md').replace(/\s+/g, ' ')
    expect(flatText).toContain('a locked feature, planned automatically, asks for it with a handback')
    expect(text).toContain('The feature never reads "Needs you" while locked')
    expect(text).not.toContain('With the orchestrator')
    expect(text).toContain('whether this epic is on autopilot and which features it runs from `get_project_context` and `get_feature_context`, the briefs for intent')
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
    expect(skill()).toContain('**Never decide for the human**, unless they handed you their decisions on autopilot, and then never past its hard limits.')
    expect(read('feature', 'references', 'planning-alone.md')).toContain('- **For the human.** Every decision that changes what the human gets')
  })

  it('acts only on what the human asked, as far as they asked, or on the run plan agreed for autopilot', () => {
    const text = section()
    expect(text).toContain(
      '**Act only on what the human asked in this conversation, as far as they asked, or on the run plan they agreed for autopilot, as far as it goes.**',
    )
    expect(text).toContain('"Check on X" is a read, not a licence to start X')
    expect(text).toContain('**Questions, portfolio answers and health sweeps never lead to action on their own**')
    expect(text).toContain("**No limits beyond the human's buttons and autopilot**")
    expect(text).toContain("any message, stop, drive or merge on a feature not locked to this epic's autopilot")
  })

  it('stops when told, saying what is still in flight, and ends autopilot on "stop"', () => {
    const text = section()
    expect(text).toContain('**When the human tells you to stop, start nothing new**')
    expect(text).toContain('tell them what is still in flight')
    expect(text).toContain('On autopilot, "stop" also ends it (`set_autopilot({ action: "off" })`)')
    expect(text).toContain('news from its features starts you again even after this chat ends')
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

  it("talks to a locked feature's agent both ways, and to no other", () => {
    const text = section()
    expect(text).toContain('**`send_to_feature({ slug, message })`**, on autopilot only, delivers your message into a locked feature\'s chat.')
    expect(text).toContain('It arrives opening with a line naming this epic')
    expect(text).toContain('It counts as the human only when they handed you their decisions, or when you relay their answer marked as their own words.')
    expect(text).toContain('**`read_feature_chat({ slug })`**')
    expect(text).toContain('**On autopilot this epic is the only place the human talks** about its locked features: they cannot type in those chats.')
    expect(text).not.toContain('**A feature is busy while the human is using its chat**')
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
    expect(text).toContain('**A decision that changes what the human gets is theirs**, unless they handed you their decisions on autopilot')
    expect(text).toContain('`**For the human.**`')
    expect(text).toContain('Building runs on its own; their decisions never do.')
    expect(text).not.toContain('a wrong guess would cost a round')
    expect(text).toContain('**One question at a time**')
    expect(text).toContain('**Keep everything else moving while you wait**')
    expect(text).not.toContain("saying it is the human's answer")
  })

  it('hears a feature only through its lead, and only while it is locked to this epic', () => {
    const text = section()
    expect(text).not.toContain('### Owning')
    expect(text).not.toContain('### Holding')
    expect(text).not.toMatch(/take_feature|You own only/)
    expect(text).toContain('`[runcastle]`')
    // A feature speaks by its lead's handback; runcastle's lines are the orchestrator's own work (agents-are-woken-only-when-it-matters 21, 23).
    expect(text).toContain("**A lead's handback** comes only from a feature locked to this epic")
    expect(text).toContain('a `wait_for_you` it calls reaches you the same way')
    expect(text).toContain('Off autopilot nothing from a feature reaches you: a lead waiting on the human pings the human.')
    expect(text).toContain('are about your own work only')
    expect(text).not.toContain('For its next turn')
    expect(text).not.toContain('Since you were last live')
  })

  it("merges through runcastle and never works in a live session's worktree", () => {
    const text = section()
    expect(text).toContain('**Merge through runcastle**: `merge_feature`')
    expect(text).toContain("**Never work in a feature's worktree while that feature has a live session.**")
    expect(text).toContain('**`decisions.md` is the record**')
  })

  // the-epic-hears-when-its-features-merge decisions 3, 6, 9, 10, 11, 13.
  it('checks a merged feature of its cut against the siblings in progress, and speaks only on a misfit', () => {
    const text = section()
    expect(text).toContain('each wakes you, except a merge line with nothing to check')
    expect(text).toContain('**A feature you cut merged** (anyone\'s merge)')
    expect(text).toContain('with no tests, drives or reviews')
    expect(text).toContain('`send_to_feature` only the locked ones it touches')
    expect(text).toContain('A clean fit ends silently.')
    expect(text).toContain('`notify_human` once; create nothing and ask nothing in features off autopilot')
    expect(text).toContain('Your own `merge_feature` answer lists them instead.')
    expect(text).toContain('it does not wake you and needs nothing')
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

  it('recognises an orchestrator message by its opening line, and never counts it as the human', () => {
    const note = read('feature', 'SKILL.md')
    expect(note).toContain("a message that opens with a line saying it is from the project's orchestrator")
    expect(note).toContain('Off autopilot it never counts as the human: it confirms no decision of theirs and never approves a design')
  })

  it('marks a change made on the orchestrator\'s message, and clears marks only on the human\'s own words', () => {
    const at = text().indexOf("**A change on the orchestrator's message is not the human's.**")
    expect(at).toBeGreaterThanOrEqual(0)
    const docs = text().slice(at, text().indexOf('\n\n', at))
    expect(docs).toContain("open with a line saying they are from the project's\norchestrator")
    expect(docs).toContain('`**Changed by the orchestrator:** <why>`')
    expect(docs).toContain('keeps its\n`**Assumed.**` line, or gains one')
    expect(docs).toContain("An orchestrator message never counts as the\nhuman confirming: only the human's own words in this chat remove the marks.")
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
