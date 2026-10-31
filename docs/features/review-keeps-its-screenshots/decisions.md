# Decisions — Review keeps its screenshots

Planned without the human (self-planning run, 2026-10-31). Decisions marked
**Assumed.** were made by the planner and name the alternative they were chosen
over. **Challenged:** carries the independent challenger's disagreement, with the
planner's answer standing.

## 1. A review pass keeps a record of what it saw, beside its walkthrough
**Decision:** Each review pass keeps, in its own folder in runcastle's data directory, one record in order: every scenario it ran and whether it landed, every screenshot with a caption, and every call it tried with `try_call`, with the request and the response. The record belongs to the pass: a verification pass has its own, and a re-burn of the same ticket replaces it. It never enters the repo, and a pass that dies part-way keeps what it had.
**Why:** The fact the brief asked to check still holds: today a pass keeps only its video and digest, and `try_call` responses vanish. Keeping it with the pass, as a file and not a database row, matches how the walkthrough works: the file on disk is the record, so a crashed pass needs no repair.
**Assumed.** Alternative: one store per feature, with each new pass adding to it.
**Challenged:** Keep no calls: they do not help anyone accept from a phone, and they are the only reason masking exists. Also, a re-burn that dies early loses good pictures, so replace them only once the new pass has one. The planner's answer stands: the feature's one-liner names the calls, and a re-burn already replaces the walkthrough the same way.

## 2. Runcastle takes each scenario's entry picture; the agent asks for the rest
**Decision:** Both, because they cover different gaps. When a scenario lands, runcastle itself opens its entry page in the agent's own browser, waits a few seconds for it to settle, and takes the picture, so the agent's next step starts on that page. Beyond that, the agent asks for a picture at each check with `review_drive({ action: "capture", caption })`, the caption saying what it checked. Runcastle takes every picture and picks every file name, so the agent never writes into the folder. A failed picture never fails the review: the entry says why, and the walk carries on.
**Why:** The older plan said runcastle could not take the entry picture, because only the agent's browser holds the page and its login. That is no longer true. I tested it on agent-browser 0.26: a second process can open a page in a session that is recording, and screenshot it, in under half a second, and the walkthrough still saves. So the challenge to that plan wins: a scenario's entry picture no longer depends on an agent under pressure remembering it. Only the agent knows when it is checking something, so the check pictures stay its job.
**Assumed.** Alternative: the older plan's way, where the agent asks for every picture including the entry page.

## 3. A pass with no picture says so, and nothing enforces more
**Decision:** On a project with no scenarios, the agent's own pictures are all there is. A pass that drove and took none says "The review took no screenshots" where the pictures would be. Nothing refuses, retries or fails a pass for this.
**Why:** The owner's rule is that review is an optional tool and no machinery may hold anything for it. A visible gap is enough, and the orchestrator can ask the lead for pictures.
**Assumed.** Alternative: pull a few frames out of the walkthrough video with ffmpeg when a pass took none.
**Challenged:** Take the ffmpeg frames, labelled as frames from the video. A drive already needs ffmpeg, and without them a project with no scenarios still depends on the agent remembering, which is what the brief feared.

## 4. Credentials in recorded calls are masked; bodies are kept as they are
**Decision:** A recorded call keeps its method, URL, status, time, headers and body, but the values of `Authorization`, `Cookie` and `Set-Cookie` are replaced with a mask. The body is kept whole, up to the existing 256 KB limit.
**Why:** The record outlives the drive and is about to be reachable from a phone. Nobody judges a call by its token, so masking loses nothing. Scrubbing bodies would need code that understands them, and these are dev-drive data, so the older plan's "local dev data" reasoning still holds for them.
**Assumed.** Alternative: keep everything unmasked, as the older plan did.
**Challenged:** Bodies and URLs are where login responses carry tokens, and "dev data" cannot be promised for every project. Mask those too, or keep calls off the phone.

## 5. The pictures live in the opened review ticket, because the review page is gone
**Decision:** The brief says "the review page", but that page was retired: a review is now a ticket in the Work view, where "Watch the walkthrough" and the findings live. So a finished review ticket gets a **What the review saw** part, directly under its action buttons and above its goal. It shows on a pass that failed or was stopped too, if it kept anything. The ticket's collapsed row says how many screenshots it holds, so they are findable without opening every ticket.
**Why:** It is where review's evidence already is. Bringing back a whole page for one section would undo a decision the app already made.
**Assumed.** Alternative: a new Review view with the pictures as its first section.

## 6. Pictures group by scenario, and look the same as pictures in chat
**Decision:** Each scenario the pass ran is one group: its name, whether it landed, its pictures in order, and its calls (status, time, request folded, body folded). Pictures taken outside any scenario sit in a last group called **Other checks**, and a pass with no scenarios simply lists its pictures. Each picture shows with its caption, the first few per group with "Show N more", and a click opens the same full-window viewer as files in chat. The screen reuses the chat's picture components as they are.
**Why:** Grouping puts a picture beside the call that produced it. Reusing the chat's pictures means they already work on a phone and the human learns nothing new.
**Assumed.** Alternative: one flat timeline of everything in the order it happened.

## 7. A review that only read the code says so in one line
**Decision:** A Gates pass, which reads the code and never starts the app, shows one quiet line in place of the pictures: "This review read the code, so it has no screenshots." So does a pass whose drive could not start.
**Why:** The human looking for pictures should learn why there are none, without reading the digest.
**Assumed.** Alternative: show nothing for such a pass.

## 8. The orchestrator gets every pass that took pictures, newest first, and how old each is
**Decision:** `read_feature_chat`, the tool the orchestrator already calls when it presents a feature, gains `reviewShots`: every pass with at least one picture, newest first, each with its pictures' absolute paths and captions and how many commits the feature branch has moved on since that pass reviewed it. The project skill tells the orchestrator to show the newest pass's pictures with `show_file` when it asks the human to accept a feature, to add an earlier pass's where they cover a screen the newest does not, and to say so when pictures predate later work. `get_feature_context` gives the lead the same list, and the feature skill tells the lead to show the review's pictures in its chat when it says ready.
**Why:** The whole point is accepting a feature from a phone, through the orchestrator. A verification pass may take one picture of a fix, and a Gates pass none, and neither should hide the fuller set an earlier pass took. The age is counted in commits, not tickets, because a lead often builds without tickets and old pictures would otherwise look current. Adding to the existing tool costs one line in the skill; a new tool would be one more thing to remember.
**Assumed.** Alternative: a separate `read_feature_screenshots` tool that returns only the newest pass.

## 9. A feature with no review gets no new way to make a picture
**Decision:** Nothing new. The orchestrator says there are none, or asks the lead through the path it already has ("If a feature with a screen showed nothing, ask its lead for screenshots"). The lead can show a design preview or any picture it has with `show_file`.
**Why:** The charter says starting the app is the expensive step, and it says runcastle never starts the app just to look at it. A lighter capture would be a drive by another name. The existing path already answers the need.
**Assumed.** Alternative: a small "take a picture" drive the lead can request without a review.

## 10. Pictures are taken at the width the agent's browser uses
**Decision:** Runcastle adds no phone-width capture. Pictures are taken as the agent's browser shows the app, and on a phone the human opens one and zooms in with their fingers. A better phone viewer belongs to "Runcastle on your phone". When a feature's acceptance criteria name a phone layout, the agent resizes its browser and captures that, as it would to check it at all.
**Why:** The phone is how the human looks, not what the feature under review is. A second capture at another width would resize the agent's browser under its own walk and its recording.
**Assumed.** Alternative: every picture taken twice, at desktop and at phone width.

## 11. Pictures are kept as long as the walkthrough
**Decision:** Pictures survive a merge, so the human can look back at a shipped feature. Nothing deletes them, which is how walkthroughs are treated today, and each pass is capped at 60 pictures so a runaway loop cannot fill the disk.
**Why:** A picture is much smaller than the video already kept beside it, and clean-up of review folders would be a feature of its own, covering the videos too.
**Assumed.** Alternative: delete a feature's pictures a while after it merges.

## 12. The agent takes every picture
**Decision:** Supersedes: 2. Runcastle takes no pictures on its own. The review agent takes all the screenshots a review needs, through `review_drive({ action: "capture", caption })`, and runcastle only files each one with its caption. A failed picture never fails the review.
**Why:** The human's call: the automatic entry picture adds nothing the agent cannot take, and it would need runcastle to drive the agent's browser.

## 13. What a review leaves arrives in the chat as a Review Package
**Decision:** Supersedes: 5, 6, 8. When a review pass ends, runcastle itself posts one **Review Package** in the feature's chat: a single attachment that says what the review concluded and what it holds. A click opens a full-window page with the pictures, the walkthrough, the calls, the findings and the review's account. The orchestrator shows the same package in its own chat with a new tool, `show_review_package({ slug })`, in place of showing pictures one by one, and the package says how old it is against the branch. The review ticket keeps its goal and criteria and gains one "Open review package" button, so "Watch the walkthrough", the findings and the digest leave it. The card is the contact sheet, and the page shows one thing at a time with everything listed beside it.
**Why:** The human's idea, tried against a filmstrip and a single cover picture: evidence belongs where the conversation is, not inside a ticket. Runcastle posts it rather than the lead, so it cannot be forgotten. One attachment keeps a chat short, and a full-window page works from any chat and on a phone.

## 14. Every feature ends with a review round, unless the human says no
**Decision:** The feature skill changes its default. When the work is done, the lead runs one review round before saying ready, even if it built everything itself, by emitting a single review ticket. It skips the round only when the human says they do not want one. The plan preview says the round is coming, so the human's yes to the plan covers it. It stays skill guidance: nothing on the server refuses, gates or holds a merge without a review.
**Why:** The human's call. Leads now build most features themselves, so review tickets rarely run and there would be no package to accept from a phone. A round holding only a review ticket already works: the scheduler has no implementation tickets to wait on. The cost is one drive, about half an hour, during which the review holds the project's drive slot and checkout. A change with nothing to drive gets a Gates review, which needs no drive.

## 15. Findings are one page in the package
**Decision:** The package's list has one **Findings** row, not a row per finding. Opening it shows every finding of the pass on one page, defects first and observations quieter, each in full: its title, what happened, where, how to reproduce it, and what it cites.
**Why:** The human's call. One title alone on a large stage looked empty, and a finding holds more than its title. Read together, findings are a list to go through, not pictures to step between.
