# Purpose

The human reported (2026-11-11) that runcastle's agents move on without asking. Their example: they said "we need to track something", gave no how or where, and an agent assumed a dashboard on the settings page and started creating designs. Their words: "Always keep the user on the same page. Shouldn't make assumptions. When in doubt, grill. The plan it yourself is to resolve small details, not the most important parts of the feature." The human should feel like the CEO: they make every important decision and always know what is going on.

The orchestrator read the instructions and found the behaviour is written into them, in three places:

- `packages/skills/packs/runcastle/skills/feature/references/planning-alone.md`: a run with no human writes each open question, "then accept[s] your own recommendations", and designs the feature's screens ("Designing alone"). A vague request therefore becomes a guessed screen by design.
- `packages/skills/packs/runcastle/skills/feature/references/design.md` ("Offer it early"): the lead is told to offer the live design "in your first reply, before you talk layout in words", which pulls it toward drawing a screen before anyone settled whether there is a screen, or where.
- `packages/skills/packs/runcastle/skills/project/references/intake.md` (§1b): the orchestrator may propose a cut after one answered question of any kind, and is told to leave UX detail for the feature's own grill. "Where does it live" passes through unasked.

This feature changes instruction text (the skill pack, and any briefing text the server generates that repeats these rules, e.g. `packages/server/src/launcher/artifacts.ts`), plus the rename below.

## Decided with the human

1. **Three things are never guessed, by any agent: what the human gets, where it lives in the app, and who sees it.** If the request does not say them, the agent asks before it creates, plans or designs anything. When in doubt, grill. Everything below that level (wording, layout details, edge cases) may still be guessed in a self-made plan and corrected afterwards.
2. **"Plan it yourself" stays as it works today**: it plans on its own guesses for small details and the human corrects the plan afterwards. The human uses it when a feature is simple and the agent will get most of it right, to avoid a long grill answered with "go with your recommendation". It is not for settling the important parts of a feature.
3. **The orchestrator offers that planning mode only when the three are already settled.** For a vague request ("we need to track X") it asks what and where first, in its own chat, in two or three questions, before any feature is created. Concrete requests (a bug with a repro, a named tweak) get no extra questions.
4. **A feature's lead in a live chat no longer offers a design in its first reply.** It offers one once the three are settled.
5. **A feature planning alone that finds one of the three unsettled in its brief stops and asks the human** (ends its run on that question, in its own chat) instead of guessing it, and draws no screen on a guess about them.
6. **Rename "plan it yourself"**: users will not know what it means. The human suggested "something like automatic planning". This covers every place the human reads the phrase: what agents say, and the app's own labels and buttons. Tool and parameter names (`planning: 'self'`, `plan_feature`) need not change. The exact wording, and whether its pair "plan it with me" is reworded to match, is the human's to confirm: mark it **For the human** in the plan with a recommendation.

# Must not swallow

- Who owns a feature, where the human answers, and what the orchestrator relays: that is the sibling "One place to answer".
- What news reaches the orchestrator: the sibling "The epic hears when its features merge".
- Any change to how a self-planning run works beyond decision 5 (its question rounds, challenger, check-first list all stay).
- New machinery. The charter's standing directive is flexible guidance over brittle machinery: this is wording, said once and in one voice across the project skill, the feature skill and their references, not a server check.

# Understood

- The rule should be stated the same way everywhere, so the orchestrator, a lead with the human, and a lead alone all apply the one test. Consider one short shared statement each skill repeats rather than three paraphrases.
- The orchestrator's current floor ("at least one answered question") is weaker than this rule and should be replaced by it, not kept beside it.
- Skill text is tested in `packages/skills` and the server's tests in places assert exact phrases; a rename will touch those.

# Open

- The exact new name (decision 6).
- How a lone run ends on a question when nobody is there: `wait_for_you` with kind `answer` is the likely fit; it must say plainly that planning stopped because one of the three was open, and ask it in full.
- The backlog draft `self-planning-polish` lists "making Plan it yourself the default"; the human's decisions here contradict that item. Do not act on it; the orchestrator will raise striking it.

# Ordering

First of three from the epic "Agent Behaviour Tuning". "One place to answer" waits on this one, and "The epic hears when its features merge" waits on that, because all three edit the same instruction files.

Planning mode: plans itself
