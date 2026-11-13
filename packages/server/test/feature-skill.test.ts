import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { entrySkillDenyRules } from '../src/launcher/artifacts'
import { ENTRY_SKILLS, entrySkillsFor } from '../src/launcher/runtimes/skills'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * The feature lead's guidance is skill text (tickets-and-review-are-tools-not-phases
 * decision 4: judgement in the skill, not machinery), so it is pinned the way the
 * other skills are: read the shipped files and assert their wording. It folds in
 * the former ideate, lead, spec, tickets, revisit and design skills, with their
 * detail kept as reference files.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(resolvePluginDir(), 'skills', 'feature', ...parts), 'utf8')

const skill = (): string => read('SKILL.md')
/** The text with its line wraps and runs of spaces collapsed, so a reflow does not break a phrase check. */
const flat = (text: string): string => text.replace(/\s+/g, ' ')
const allTexts = (): [string, string][] => [
  ['SKILL.md', skill()],
  ...readdirSync(join(resolvePluginDir(), 'skills', 'feature', 'references'))
    .filter((f) => f.endsWith('.md'))
    .map((f): [string, string] => [f, read('references', f)]),
]

describe('the feature skill', () => {
  it('ships as the entry skill the feature chat alone may open', () => {
    expect(skill()).toMatch(/^---\nname: feature\n/)
    expect(skill()).toContain('disable-model-invocation: false')
    expect(ENTRY_SKILLS).toEqual(['feature', 'qa', 'project'])
    expect(entrySkillsFor('chat')).toEqual(['feature'])
    expect(entrySkillsFor('side')).toEqual([])
    expect(entrySkillDenyRules('chat')).not.toContain('Skill(runcastle:feature)')
    for (const kind of ['project', 'drive-fix', 'side'] as const) {
      expect(entrySkillDenyRules(kind)).toContain('Skill(runcastle:feature)')
    }
  })

  it('makes the chat the lead from its first message, with nothing to unlock', () => {
    expect(skill()).toContain("You are this feature's lead from your first message until the human merges it.")
    expect(skill()).toContain('nothing has to be unlocked')
  })

  it("asks for the human's explicit yes before any work, and again for an unsettled worker", () => {
    const text = flat(skill())
    expect(text).toContain("get the human's **explicit yes in chat**")
    expect(text).toContain('Ask again before any worker the agreed plan did not settle.')
    expect(text).toContain('That yes does not approve designs')
  })

  it('hands build work to workers by a firm offering rule, with no build tickets', () => {
    const text = flat(skill())
    expect(text).toContain('## Build it the cheapest good way')
    expect(text).toContain('**Taste work**')
    expect(text).toContain('**"with you"** worker')
    expect(text).toContain('**"on its own"** worker')
    expect(text).toContain('**Small jobs** you do yourself')
    expect(text).toContain('There are no tickets and no rounds to run: the review at the end is a worker too.')
    expect(text).toContain('The human\'s yes to the plan, or to that offer, starts them, with no approval per worker.')
  })

  it('ends every feature with a Review worker unless the human declines, then a verify review, and always runs the checks before ready', () => {
    const text = flat(skill())
    expect(text).toContain('## Every feature ends with a review')
    expect(text).toContain('start the **Review worker** before you say ready')
    expect(text).toContain('`start_review({ checksPassed })`')
    expect(text).toContain('start a **verify review** given only those findings and the fix commits')
    expect(text).not.toMatch(/review round|review ticket/)
    expect(text).toContain('Skip it only when the human says they do not want one.')
    expect(text).toContain('No server rule requires any of this')
    expect(text).toContain("run the project's own checks (its typecheck and its tests) and fix what they find, unless nothing changed since your last green run")
    expect(text).toContain('only inside `docs/features/<slug>/`')
  })

  it('runs the checks once per commit: the lead hands its green pass to the review and leaves the model to Settings', () => {
    const text = flat(skill())
    expect(text).toContain('**The checks run once per commit.**')
    expect(text).toContain('`checksPassed: { commit, commands }`')
    expect(text).toContain('Never pass a red run.')
    expect(text).toContain('Leave out `model` unless the human asked for one: the Review row in their Settings decides')
    expect(text).toContain('`declare_ready({ scenario })`')
    expect(text).toContain('**how you checked it**')
  })

  it('stops itself when a round makes no progress, and leaves Merge and drafts alone', () => {
    const text = skill()
    expect(text).not.toContain('**Runaway guard.**')
    expect(text).toContain('`wait_for_you({ why: "stuck: <a few words>" })`')
    expect(text).toContain("Merge is the human's, and so is starting a backlog feature.")
    expect(text).toContain('**Never reword a `ticket(<seq>): …` or `runcastle: …` commit**')
  })

  it('owns the work: a helper drives, a step-back after two failed rounds, a stop after three (agents-test-like-owners)', () => {
    const text = flat(skill())
    expect(text).toContain('## Own the work')
    expect(text).toContain('**Check through a helper.** Whenever you drive the app to check your work, the first time too')
    expect(text).toContain('A round is your fix, or a worker you sent back, followed by any check (drive, test, typecheck, build) still showing that problem.')
    expect(text).toContain('A new direction from the human resets the count.')
    expect(text).toContain('**After the second, step back** before a third try')
    expect(text).toContain('**After the third, stop.** Start nothing new; workers on parts that do not depend on it finish their assignment.')
    expect(text).toContain('**Change how freely; ask before changing what.**')
    expect(text).toContain('A worker the plan did not name still needs their yes.')
    expect(text).toContain('**Name what is broken nearby** and offer to park it in the backlog')
    expect(text).toContain('then `wait_for_you({ why: "stuck: <a few words>" })`.')
    const ref = flat(read('references', 'checking-your-work.md'))
    expect(ref).toContain('**The helper never edits code**')
    expect(ref).toContain('the last screenshot of a drive you are about to call a pass')
    expect(ref).toContain('`wait_for_you({ why: "stuck: <a few words>" })`, under an epic too')
    expect(flat(read('references', 'workers.md'))).toContain("Each send-back on the same problem is a round in that problem's count")
  })

  it('links every reference file it carries', () => {
    for (const ref of ['grilling', 'spec', 'workers', 'planning-alone', 'preview', 'design', 'checking-your-work']) {
      expect(skill()).toContain(`./references/${ref}.md`)
    }
    expect(skill()).toContain('./references/preview-starter.html')
  })

  it('names no Go, lap, phase, complete_phase or mandatory review ticket anywhere', () => {
    for (const [file, text] of allTexts()) {
      expect(text, file).not.toMatch(/\bGo\b|\blaps?\b|(?<!capture-)\bphases?\b|complete_phase|go_feature/)
      expect(text, file).not.toMatch(/every batch closes with/i)
    }
  })

  it('stays project-agnostic: no runcastle-repo paths', () => {
    for (const [file, text] of allTexts()) {
      expect(text, file).not.toMatch(/packages\/|apps\/web|STYLE\.md|DESIGN\.md/)
    }
  })
})

describe('the feature skill, keeping the lead chat small (lead-chats-stay-small)', () => {
  it('prefers its own subagents for reading, surveys and screenshot loops, each on a named model', () => {
    const s = flat(skill())
    expect(s).toContain('Prefer your own subagents')
    expect(s).toContain('not runcastle workers')
    expect(s).toContain('an Explore-type subagent returns a short map')
    expect(s).toContain('You still show the human that picture.')
    expect(s).toContain('read its actual diff where it matters and run the project\'s checks yourself')
    expect(s).toContain("**Name a model for every subagent** from the human's use-case notes (`annotatedModels`")
    expect(s).toContain('With no notes, the subagent runs on your own model.')
    expect(s).not.toContain('Sonnet')
  })

  it('still lets the lead write code, through Read and Edit', () => {
    const s = flat(skill())
    expect(s).toContain('**Small jobs** you do yourself')
    expect(s).toContain('no patch scripts in /tmp, no long heredocs. A script is for one change across many files.')
  })

  it('talks to the human, or to its epic only while on autopilot (epics-on-autopilot decisions 1, 14)', () => {
    const text = flat(skill())
    expect(text).toContain('## The human, or the epic on autopilot')
    expect(text).not.toContain('## Talk to your owner')
    expect(text).toContain("A feature is the human's unless its epic (the orchestrator chat that created it) is on autopilot and runs it.")
    expect(text).toContain('`autopilot` is null, or names the epic')
    expect(text).toContain('- **Off autopilot** (the usual case), talk to the human here and ask with `wait_for_you`, as below.')
    expect(text).toContain('`hand_back` to it is refused')
    expect(text).toContain('- **On autopilot**, the human cannot type in this chat: the epic is the only place they talk. Bring everything to the epic with `hand_back({ summary })`: questions, the plan\'s yes, "ready", a merge conflict.')
    expect(text).toContain('A `wait_for_you` you call anyway goes to the epic the same way.')
    expect(text).toContain("- **When autopilot ends**, runcastle tells you the feature is the human's again. Re-ask any open question here with `wait_for_you`.")
    expect(text).not.toMatch(/planAgreed|Yours to plan|take_feature/)
    expect(text).not.toContain('`wait_for_you` is refused')
    expect(text).not.toContain('With the orchestrator')
    expect(text).not.toContain('working agreement')
  })

  it('re-reads the feature state after any compaction', () => {
    expect(flat(skill())).toContain('after any compaction, call `get_feature_context` before you act on the summary')
  })

  it('surveys the code through a subagent when planning alone', () => {
    expect(flat(read('references', 'planning-alone.md'))).toContain('Send the codebase survey to one Explore-type subagent')
  })

  it('no longer forbids compaction, only compacting yourself', () => {
    const grilling = flat(read('references', 'grilling.md'))
    expect(grilling).not.toContain('Never compact. Never `/clear`.')
    expect(grilling).toContain('Never compact or `/clear` yourself:** runcastle compacts you at quiet moments')
  })
})

describe('the feature skill, workers', () => {
  const text = (): string => flat(read('references', 'workers.md'))

  it('starts workers only on the human\'s yes, with a label, purpose and kind', () => {
    expect(text()).toContain('Start workers on the human\'s yes to the plan, or to an offer in chat.')
    expect(text()).toContain('`start_worker({ label, purpose, kind, goal, doneWhen, model? })`')
    expect(text()).toContain('`"with-you"` for taste work, `"on-its-own"` for build work')
    expect(text()).toContain('Never invent an id.')
  })

  it('writes concrete assignments: a stated check, named tests, design references, one area each', () => {
    expect(text()).toContain('**State the check.**')
    expect(text()).toContain('never the whole suite')
    expect(text()).toContain('**UI work names its design references**')
    expect(text()).toContain('**One area each.**')
    expect(text()).toContain('Pieces that run side by side should touch different files')
  })

  it('ships a scenario for hard-to-reach state only in a set-up project', () => {
    expect(text()).toContain('**Ship a scenario when the state is hard to reach.**')
    expect(text()).toContain('**When `setUp` is false**, card nothing about scenarios.')
  })

  it('lands, sends back or drops a handback, and trusts the commits over the summary', () => {
    expect(text()).toContain('Trust the commits over the summary.')
    expect(text()).toContain('`land_worker({ workerId })`')
    expect(text()).toContain('`send_back_worker({ workerId, note })`')
    expect(text()).toContain('`drop_worker({ workerId })`')
    expect(text()).toContain('`message_worker({ workerId, text })`')
    expect(text()).toContain('Never ask a worker for its transcript')
  })

  it('starts the Review worker when the work is done, resolves its findings, then verifies the fixes', () => {
    expect(text()).toContain('## The review')
    expect(text()).toContain('`start_review({ checksPassed })`')
    expect(text()).toContain('**Hand it your green checks.**')
    expect(text()).toContain('**Leave its model to Settings.**')
    expect(text()).toContain('Run your checks after the fixes and pass `checksPassed` here too.')
    expect(text()).toContain('It waits as queued while the human drives.')
    expect(text()).toContain('**Its handback is the Review Package**')
    expect(text()).toContain('Close each finding with `resolve_finding`')
    expect(text()).toContain('`start_review({ verify: { findingIds, commits } })`, with only those findings and the commits that fixed them')
    expect(text()).toContain('Never `land_worker` it.')
  })
})

describe('the feature skill, planning with no human present', () => {
  const text = (): string => read('references', 'planning-alone.md')

  it('plans and does not build', () => {
    expect(text()).toContain('**This run plans; it does not build.**')
    expect(text()).toContain('never call `start_worker` or `start_review` in this run')
  })

  it('works in one turn, with one challenger and at most five to check first', () => {
    expect(text()).toContain('**One turn.**')
    expect(text()).toContain('**Exactly one challenger.**')
    expect(text()).toContain('Pick at most five decisions')
    expect(text()).toContain('**A refused tool is not a wait.**')
  })

  it("ends by asking for the human's yes with wait_for_you", () => {
    const close = flat(text().slice(text().indexOf('## Straight through, then ask')))
    expect(close).toContain('asking the human for their yes to start the work')
    expect(close).toContain('`mcp__runcastle__wait_for_you({ why: "start the work?" })`')
  })

  it("hands the plan to its epic for its yes on autopilot, and the open three to the epic's wait too (epics-on-autopilot)", () => {
    const close = flat(text().slice(text().indexOf('## Straight through, then ask')))
    expect(close).toContain('**On autopilot** (SKILL.md, "The human, or the epic on autopilot"), the plan\'s yes is the epic\'s to give: call `hand_back({ summary })` in place of `wait_for_you`')
    expect(close).toContain('every For the human decision and any design waiting')
    const three = flat(text().slice(text().indexOf('**The three come first.**')))
    expect(three).toContain('On autopilot that wait goes to the epic, which answers or asks the human')
  })

  it('plans the workers it would offer and starts none', () => {
    expect(flat(text())).toContain('never call `start_worker` or `start_review` in this run: nothing starts without the human\'s yes')
    const close = flat(text().slice(text().indexOf('## Straight through, then ask')))
    expect(close).toContain('Plan the workers by the offering rule')
    expect(close).toContain('Start none.')
    expect(close).toContain('which workers it offers and what you will do yourself')
  })

  it('designs the screens it adds or reshapes, and leaves them for the human (designs-wait-for-you)', () => {
    const alone = text().slice(text().indexOf('## Designing alone'), text().indexOf('## Straight through, then ask'))
    expect(alone).toContain("**adds a screen or changes a screen's layout**")
    expect(alone).toContain('**At most two\n  open choices per screen**')
    expect(alone).toContain('`start_design_server({ command })`')
    expect(flat(alone)).toContain('`agent-browser open <url>`')
    expect(flat(alone)).toContain("hand the loop to a subagent on the model the human's notes give UI work")
    expect(flat(alone)).toContain('Do not read the images yourself.')
    expect(alone).toContain('**Leave the designs uncommitted.**')
    expect(alone).toContain("lives in the design page, never in the app's own files")
    expect(flat(alone)).toContain('never once per state')
    expect(flat(alone)).toContain('check every state of every design page')
    expect(flat(alone)).not.toContain('one design page per state')
    expect(text()).toContain('Never call\n  `show_panel`')
    const close = text().slice(text().indexOf('## Straight through, then ask'))
    expect(close).toContain('Call `show_plan()` once, before the closing message')
    expect(close).toContain('only designs the human approves are committed')
    expect(flat(close)).toContain('name each designed screen and the states its switcher holds')
  })

  it('makes one design per screen, its states on a switcher inside it (one-design-per-screen)', () => {
    const design = flat(read('references', 'design.md'))
    expect(design).not.toContain('One design page per state')
    expect(design).toContain('One design page per screen')
    expect(design).toContain('Never a second design for a state, a variant or a tweak')
    expect(design).toContain('?state=<name>')
    expect(design).toContain('never once per state')
    expect(design).toContain('Keep the state switcher')
    expect(flat(read('references', 'workers.md'))).toContain("states on the design page's switcher")
    expect(flat(read('references', 'preview.md'))).toContain('the states its switcher holds')
    expect(flat(read('references', 'preview-starter.html'))).toContain('<p>States:')
  })

  it('lets only the human approve a waiting design (designs-wait-for-you)', () => {
    const design = read('references', 'design.md')
    expect(design).toContain('**Only the human approves**')
    expect(design).toContain('`set_design_state({ path, state: \'approved\' })`')
    expect(design).toContain('**They say yes to the plan**: that yes does **not** approve designs')
    expect(design).not.toContain('also approves every design')
    expect(flat(read('SKILL.md'))).toContain('Off autopilot it never counts as the human: it confirms no decision of theirs and never approves a design')
    const orchestratorYes = flat(design.slice(design.indexOf('- **The orchestrator says yes to start the work**')))
    expect(orchestratorYes).toContain('off autopilot, do not start; the designs wait for the human\'s own yes in this chat.')
    expect(orchestratorYes).toContain('On autopilot, its approval counts when the human handed their decisions to the epic or it relays the human\'s own answer')
  })

  it('has every design page report its state and tweaks, kept by path, for Approve (agents-see-the-tweaks-you-picked)', () => {
    const design = flat(read('references', 'design.md'))
    expect(design).not.toMatch(/paste/i)
    expect(design).not.toContain('one line of text')
    expect(design).toContain('**Every design page reports**, single-state ones and pages without Tweaks included')
    expect(design).toContain("window.parent.postMessage(report, '*')")
    expect(design).toContain("{ type: 'runcastle-design-report', state, tweaks }")
    expect(design).toContain('`{}` when the page has no Tweaks menu')
    expect(design).toContain('in `localStorage` under a key that includes the design\'s path')
    expect(design).toContain('restores them on load')
    expect(design).toContain('The chosen tweak values arrive in the approval line')
  })

  it('asks with the tool, with no kinds of wait (needs-you-is-the-agent-s-call 4, 11, 17)', () => {
    const text = flat(skill())
    expect(text).toContain('**Ask with the tool, every time.**')
    expect(text).toContain('take it back with `wait_for_you({ withdraw: true })`')
    expect(text).not.toMatch(/kind: "|`"design"`|Design to approve/)
    expect(flat(read('references', 'design.md'))).toContain('A design waiting for approval does not tell the human by itself')
  })
})

describe('the feature skill, grilling', () => {
  const text = (): string => read('references', 'grilling.md')

  it('documents the assumed and challenged lines with an example', () => {
    expect(text()).toContain('**Assumed.** Alternative: <the main alternative>.')
    expect(text()).toContain("**Challenged:** <the challenger's reason>.")
    expect(text()).toContain('**Assumed.** Alternative: a small footer with tags and the last-edited date.')
  })

  it("clears the marks only from decisions the human touched", () => {
    expect(text()).toContain('Decisions they did not touch keep theirs.')
  })
})
