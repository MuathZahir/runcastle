import { readdirSync, readFileSync } from 'node:fs'
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
  'list_tickets',
  'get_ticket',
  'start_feature',
  'plan_feature',
  'send_to_feature',
  'read_feature_chat',
  'stop_feature_run',
  'drive',
  'merge_feature',
  'add_to_brief',
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
    const top = text.slice(0, text.indexOf('## Your tools'))
    expect(top).toContain("**You are also always this project's orchestrator.**")
    expect(section()).toContain('This is standing guidance')
    expect(text).not.toMatch(/when your briefing says you are the orchestrator|applies only (then|when)/i)
    expect(text).not.toMatch(/setting|experimental|turns? the mode/i)
  })

  it('names every tool the project session has, and none it lost', () => {
    const text = skill()
    const tools = text.slice(text.indexOf('## Your tools'), text.indexOf('## 0.'))
    for (const tool of PROJECT_TOOLS) expect(tools).toContain(`\`mcp__runcastle__${tool}(`)
    expect(tools).toContain('`mcp__runcastle__send_to_feature({ slug, message, relaysHuman? })`')
    expect(tools).toContain('`humanTypedAt`')
    expect(text).not.toMatch(/take_over_feature|record_test_note|complete_phase/)
  })

  it('acts only on what the human asked, as far as they asked, or within a cut agreement', () => {
    const text = section()
    expect(text).toContain(
      '**Act only on what the human asked in this conversation, as far as they asked, or within a cut whose working agreement they made.**',
    )
    expect(text).toContain('"Check on X" is a read, not a licence to start X')
    expect(text).toContain('**Questions, portfolio answers and health sweeps never lead to action on their own**')
    expect(text).toContain("**A feature the human is running by hand is theirs** unless they ask you to act on it")
    expect(text).toContain('**No limits beyond the human\'s buttons**')
  })

  it('stops when told, saying what is still in flight, and when the project chat ends', () => {
    const text = section()
    expect(text).toContain('**When the human tells you to stop, start nothing new**')
    expect(text).toContain('tell them what is still in flight')
    expect(text).toContain('Ending the project chat stops you too')
  })

  it('agrees how the cut is run before creating anything, merging included, and works within it', () => {
    const text = section()
    const agreement = text.indexOf('### The working agreement')
    expect(agreement).toBeGreaterThanOrEqual(0)
    expect(agreement).toBeLessThan(text.indexOf('### Grill, create, plan, start'))
    expect(text).toContain('**Before you create anything for a cut, ask the human how they want the work run.**')
    expect(text).toContain('One question, with your recommendation')
    expect(text).toContain('say what each means for merging')
    expect(text).toContain('**Autonomous**: you carry everything through to merged')
    expect(text).toContain('**Checkpoints they name**')
    expect(text).toContain('merge only what they have passed there')
    expect(text).toContain('**A check-in after each feature**')
    expect(text).toContain('merge it only once they say so')
    expect(text).toContain('**"You decide" means autonomous, merge included.**')
    expect(text).toContain('**Outside a cut, merge only when the human asks you to.**')
    expect(text).toContain('**Always offer all three shapes**, even for a cut of one feature')
    expect(text).toContain('**Every new request is a new cut**')
    expect(text).toContain('unless the human has said the earlier agreement stands for it')
    expect(text).toContain('**Write the agreement into the brief of every feature in the cut**')
    expect(text).toContain('read the agreement back from the briefs')
    expect(text).toContain('**Autonomous: never stop for a test drive.**')
    expect(text).toContain('**never create review tickets yourself**')
    expect(text).toContain('**Checkpoints: stop exactly at the points they named**')
    expect(text).toContain('**Drive when the agreement calls for the human\'s eyes**')
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

  it('asks the human one question at a time, only when a wrong guess would cost a round', () => {
    const text = section()
    expect(text).toContain('a wrong guess would cost a round')
    expect(text).toContain('**One question at a time**')
    expect(text).toContain('**Keep everything else moving while you wait**')
    expect(text).toContain("saying it is the human's answer")
  })

  it('hears about the features it has acted on, and shows no list of them', () => {
    const text = section()
    expect(text).toContain('**You hear about the features you have acted on**')
    expect(text).toContain('until each ships')
    expect(text).toContain('`[runcastle]`')
    expect(text).toContain("a feature's agent is waiting for the human")
    expect(text).toContain('an agent declared its work ready')
    expect(text).toContain('"Since you were last live"')
    expect(text).toContain('**The app shows no list of what you follow or run**')
  })

  it("merges through runcastle and never works in a live session's worktree", () => {
    const text = section()
    expect(text).toContain('**Merge through runcastle**: `merge_feature`')
    expect(text).toContain("**Never work in a feature's worktree while that feature has a live session.**")
    expect(text).toContain('**`decisions.md` is the record**')
  })
})

describe('the project skill, with no Go, no quick changes and no missing tools', () => {
  const texts = (): string[] =>
    ['SKILL.md', 'references/triage.md', 'references/health-sweeps.md'].map((f) => read('project', ...f.split('/')))

  it('mentions neither Go, go_feature nor a quick change', () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/\bGo\b/)
      expect(text).not.toMatch(/go_feature|quick[ -]change/i)
      expect(text).not.toMatch(/create_feature\(\{[^}]*tickets/)
    }
  })

  it('speaks of rounds, never of phases, laps or burns', () => {
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

  it('leave the pack with feature, qa, project, prepare and code-review', () => {
    expect(readdirSync(skillsDir).sort()).toEqual(['code-review', 'feature', 'prepare', 'project', 'qa'])
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
