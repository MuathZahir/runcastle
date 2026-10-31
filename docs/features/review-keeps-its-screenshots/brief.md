## Purpose

The human wants to accept finished features from their phone by looking at screenshots: "we can make it so that the review agents can save screenshots from the drive." Phones get no drives, so screenshots are how a screen reaches the human there.

This already has a plan inside "Review hands you a running drive with what it saw" (`review-hands-you-a-running-drive-with-what-it-saw`), but that plan dates from 2026-10-18, never started, sits on a branch 700 commits behind main, and is tied to a separate change that keeps the review's app running. The human agreed to take only the screenshot half here. That older feature stays where it is, with this half taken out of it.

## Understood

- A review pass today leaves a walkthrough video and its digest. It is never asked for screenshots, nothing records which scenarios it ran, and `try_call` responses are kept nowhere (that feature's decision 10; check this still holds).
- The older plan is a useful source: read its decisions 10 to 13 and its spec with `read_feature_doc({ slug: "review-hands-you-a-running-drive-with-what-it-saw", relPath: "spec.md" })`. Its tickets 2 and 5 are this feature. Do not reuse them unchecked, because the review and drive code has moved a long way since.
- The screenshots are kept with the review pass in runcastle's data directory, and shown on the review page.
- Since Storybook was removed, this is the only way to see screens at review without driving. The charter says review shows the screenshots its drive took.
- The orchestrator must be able to read where a feature's screenshots are and show them in chat through the tool from "Agents show files in chat".

## Must not swallow

- Keeping the review's drive running and handing it to the human. That stays in the older feature.
- Automatic comparison of any kind: no diffs, no base captures, no masking. The human rejected that design.
- Making review mandatory. Review is an optional tool, and a feature with no review simply has no screenshots. No gate or machinery may hold a merge for this.
- Showing the images in chat, which the earlier feature in this cut owns.

## Open

- Whether screenshots come from the agent asking at each check, or from runcastle capturing each scenario's entry page by itself. The older plan chose the agent and its challenger disagreed; an agent under pressure may skip them.
- Whether a feature with no review should have some lighter way to produce a screenshot for the human, or whether the orchestrator simply says there are none.

## Ordering

Starts by itself after "Agents show files in chat" merges. "Runcastle on your phone" follows it.

## Working agreement

Agreed with the human for this whole cut (Threads hold features, Agents show files in chat, Review keeps its screenshots, Runcastle on your phone, Agents can notify your phone):

Checkpoints:
1. The human approves the phone view's design before "Runcastle on your phone" builds.
2. The human tries the finished phone link and a real notification on their actual phone, before those features merge.

Everything else is carried through to merged by the orchestrator without stopping. This feature has no checkpoint of its own. Publishing a release needs the human's yes.

## Added by the orchestrator, 2026-10-31

## Working agreement correction (orchestrator, 2026-10-31)

Checkpoint 2 splits in two, because notifications start only after the phone view merges: the human tries the phone link before "Runcastle on your phone" merges, and receives a real notification before "Agents can notify your phone" merges. This feature still has no checkpoint of its own.
