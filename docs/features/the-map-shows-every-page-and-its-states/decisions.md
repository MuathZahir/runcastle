# Decisions

Planned without the human (a self-planning run, 2026-10-19). Every decision below is the planner's own recommendation, accepted; each names the main alternative it was chosen over.

## 1. Lap 1 builds the page machinery and maps onboarding; lap 2 maps the rest
**Decision:** Lap 1 delivers:
- page stories that render the whole app at an address, with fake data;
- the map redrawn around pages and their states;
- the page rule in planning, burning and review;
- **Onboarding** mapped in full, plus the existing feature review story rewritten as one whole-page state (`Feature/Review/Findings open`).

The rest of runcastle's mapping pass (about 40–70 more stories, split by area) and the door that gives other projects their own pass are lap 2, under the spec's `## Later laps`. The feature is meant to merge after lap 2, so main's map never shows the thin lap-1 state.
**Why:** The brief asks that onboarding be mapped alone first so the human checks the look and the naming before the rest is written. The rounds inside a lap have no human in them, so the only checkpoint is the lap boundary. One deep page beside onboarding lets the human judge the hard case too: a page with many queries, the sidebar and the shell.
**Assumed.** Alternative: the whole mapping pass in lap 1, with the onboarding ticket first and every other area blocked on it, which is faster but has no human check between them.
**Challenged:** lap 1's map shows two places, fewer than today's six component groups, so it looks less complete than what set this feature off. The challenger would list every unmapped top-level place as an outline entry with a gap. Not taken: runcastle cannot know an app's places without reading its code, and the thin state is only seen in the lap-1 drive, not on main.

## 2. A page story is one that lives under `.runcastle/stories/pages/`; only those reach the map
**Decision:**
- **Page stories** live under `.runcastle/stories/pages/`. The map shows them and nothing else from the catalogue.
- **Component stories** are every other story file. They leave the map but stay in the catalogue, where the feature page's "UI states" section at review keeps showing them as today.
- Runcastle tells the two apart by the story's file path in the build's index, which is text it already reads.

**Why:** The brief takes component stories off the map and keeps them for review. The folder is visible in the file tree, mirrors `.runcastle/scenarios/`, and needs nothing from Storybook beyond the index runcastle already parses, so it stays language-agnostic.
**Assumed.** Alternative: a `page` tag on each page story (Storybook's own tags, also in the index). It is invisible in the file tree, and a forgotten tag drops a page from the map silently.

## 3. Today's eleven stories: ten stay as component stories, the review story becomes a page
**Decision:**
- The ten component stories (Burn, Feature, Map, Review and Sidebar folders) stay exactly as they are, off the map.
- `feature-page/Review.stories.tsx`, which already renders a whole page body, is rewritten as the page state `Feature/Review/Findings open`, rendered whole under `pages/`.

**Why:** The component stories still earn their keep at review, and rewriting them as page states would duplicate what the mapping pass writes anyway. The review story is the one already shaped like a page.
**Assumed.** Alternative: delete the component stories so the catalogue holds pages only, which is simpler but loses review's evidence for the components those features changed.

## 4. A page story's title is the place, its name is the state, and numbers order a flow
**Decision:**
- **The title is the place** in the app, written as you would navigate to it: `Onboarding`, `Project chooser`, `Project/Session`, `Feature/Review`.
- **Each story in the file is one state** of that place: `Empty`, `Many projects`, `Waiting for you`, `Findings open`.
- **The place is the map group.** Up to two levels, as today (`Feature › Review`); deeper titles fold into the second level, with the rest of the path shown before the state name.
- **A leading number orders states into a flow** and is shown: onboarding is the place `Onboarding` with the states `1 Welcome`, `2 Git identity`, … read in order. Unnumbered states keep the file's order.
- **States that share a number are variants of one step:** `3 Coding agents` and `3 Coding agents · None installed` sit together as step 3, so a step's variants never break the numbering or pose as extra steps.
- **Scenarios join by the same name match as today** (map decision 4), so a scenario folder named after the place sits on the same group page.

This replaces map decision 4's story rule ("title minus its last segment is the group, the last segment is the component") for page stories, and map decision 10's "every state of each component".
**Why:** It gives exactly the brief's examples (`Onboarding › 1 Welcome`, `Project chooser › Empty`) with one rule an agent can follow and runcastle can read without understanding code. Keeping the two-level tree, the loose name match and the Ungrouped rule means the sidebar and scenario joining need no new machinery.
**Assumed.** Alternative: the title is the screen and the name its state (`Onboarding/1 Welcome` with a `Default` state), which gives every onboarding screen its own row but makes a flow one level deeper and the common single-state screen carry a meaningless `Default`.

## 5. A page story renders the real app at an address, and reaches the rest by acting like a user
**Decision:**
- **The whole app, unchanged.** A page story renders runcastle's real root (`App`, under the same providers `main.tsx` stacks) with the browser's address set to the page's path first, as the app's own tests already do. There is no shell-plus-body variant.
- **Data at the edge only.** Every query the shell and the page make is answered by the story's fakes. Shared defaults (one project, a prepared host, an empty notes count, …) live in one fixtures module under `.runcastle/storybook/`, so a story states only what makes its state differ.
- **Live things are canned at the edge.** The live event stream is a stand-in that opens and stays silent. Terminals replay recorded text, and the drive frame shows a placeholder. Browser storage starts empty for every story.
- **States with no address** (each onboarding screen, Settings, ⌘K, the draft form, open dialogs) are reached by a short scripted step in the story that clicks or types as a user would, after the page loads. Never by setting the app's internal state.
- **A scripted step fails loudly.** It ends by checking that the state it reached is on screen, and a failure shows Storybook's error frame, never the starting screen under another state's name.

**Why:** The brief prefers the real app, and the app has no router: one module reads `window.location`, and its tests start it at an address by setting the URL before it mounts. Faking at the edge and acting like a user keep `features-show-their-ui-states-as-stories` decision 9 (never mock the app's modules) for whole pages. A shell-plus-body story would be a page the app never actually draws.
**Assumed.** Alternative: render the shell with a chosen body, or add a "start here" prop to the app. Both are simpler for stories, but they show a composition the app never makes, and the prop is code that exists only for the catalogue.

## 6. A group page shows its states as whole pages, large, in flow order
**Decision:**
- **Each state is a picture of the whole page:** the page rendered at a fixed desktop size (1440 × 900) and scaled down to fit, so the sidebar, topbar and body all show, the way a screenshot would.
- **One state per row, at the full width of the wide page column**, in flow order, each captioned with its state name. A flow's number reads as a step, and a step's variants sit together under it.
- **The theme follows runcastle's.** Frames render in the theme the viewer has runcastle in. There is one size; narrow layouts are not states.
- **A frame is a picture, not a control.** Clicking it opens the existing **Open larger** dialog, where the page shows full size and can be clicked through.
- **Frames load as they scroll into view**, and only a few load at once.
- **A parent group** (e.g. Feature) shows its own states first, then each child group (Planning, Building, Review, Shipped) as a section in map order. **Ways in** and **Calls** stay after the states, as today.

This replaces map decision 10's per-component blocks and fixed-height frames for the map.
**Why:** The human said the current framing "doesn't look right". A 240px-tall frame crops a whole page to its top strip. Scaling a fixed desktop viewport shows the page as it looks, and the structure is visible at a glance. Making the small frame a picture keeps scrolling the map from being caught by a page inside it. Lazy, limited loading keeps a group of a dozen whole-app frames from starting a dozen apps at once. One per row puts a 1440-wide page at about 0.7 scale, where its text can still be read; the group page is where a flow is judged, so the longer scroll is the price. (Revised after the challenge, which pointed out that two to a row is about 0.35 scale and unreadable.)
**Assumed.** Alternative: two to a row, which shows a flow in half the scroll but as unreadable thumbnails.

## 7. The map overview is the site's structure
**Decision:** Map with no group selected shows the app as a tree of places:
- every top-level place in the app, in map order, with its child places indented beneath it;
- one small picture per place (its first state);
- a tally per place ("6 states · 1 way in · 1 call").

Selecting a place opens its group page.
**Why:** The human: "I want to see the structure of my website." A list of names with tallies (today's overview) says what exists but not what it looks like. One picture per place keeps the overview to one frame per group.
**Assumed.** Alternative: keep today's text-only overview, which loads no frames but shows no pages.

## 8. A place's history line says when its stories were last updated, and says only that
**Decision:**
- **One line per story file,** at the head of its place's states: "Stories updated by Coupons, Oct 12", with earlier updates behind the existing disclosure and feature names linking to their pages.
- **It covers the story file alone,** and its wording says so: it never reads "Changed by", the component line's wording.
- Scenario entries keep their history as today.

**Why:** A page story renders the whole app, so it reaches nearly every file, and the shared-file rule (map decision 12) leaves only the story file itself. Labelled as the code's history, that would be the quietly wrong "unchanged" map decision 6 rejected. Labelled as the stories' history, it is true, and the page rule (decision 10) makes the story file the record of page changes. (Revised after the challenge; the first answer dropped the line.)
**Assumed.** Alternative: no history line on pages at all, which is honest but drops a signal the map had before.

## 9. A page story looks like a page wherever it is framed, review included
**Decision:** The feature page's "UI states" section frames page stories with the same scaled whole-page frame as the map, before and after side by side as today. Component stories keep today's fixed-height frames there. Which stories the section shows, and how they are classed as changed, new or affected, is unchanged.
**Why:** The page rule (decision 10) puts page states in front of review, and a whole page in a 240px frame would be the same cropped strip the map is dropping. Reusing the existing classification needs no new reading: a page whose story file the ticket updated is changed; pages that only reach changed code stay on the collapsed "use changed code" line.
**Assumed.** Alternative: leave the review section's frames alone and show pages only on the map. Less work, but the page states review is asked to check would be the hardest to read there.

## 10. The page rule: a ticket that adds or changes a page keeps that page's stories current, and review checks it
**Decision:**
- **Where it binds:** to places that already have page stories on main, and to brand-new pages in a project that has any page stories. An existing page that has not been mapped yet is not the ticket's job; the mapping pass covers it. A project with no page stories at all is untouched.
- **Planning:** a ticket that adds a page, adds a state worth seeing, or changes what a page shows gets an acceptance criterion naming the page stories to add or update, by place and state (`Feature/Review: add "Findings open"`).
- **Burning:** the burner prompt says the same once, so a ticket that touches a page beyond its criteria still updates its stories.
- **Review:** the reviewer judges from the diff whether a page was added or changed, and files a defect when its stories were not added or updated to show it. This is the reviewer's judgement, never a parser in runcastle.
- **Component stories stay optional,** written when planning judges a state worth seeing, as today.

**Why:** The brief reverses "a story is never required" for pages only, to keep the map complete after the mapping pass. A defect, not an observation, is what makes the next round fix it. Binding per place stops the rule from making an unmapped page's first stories the price of an unrelated ticket, which a project-wide switch would do right after lap 1, when only onboarding and one review page are mapped. (Revised after the challenge; the first answer switched the rule on project-wide.)
**Assumed.** Alternative: file a missing page story as an observation, which is less noisy but lets the map drift, the very thing the rule exists to stop.

## 11. Other projects get their mapping pass from the map's empty state, in lap 2
**Decision:**
- **Lap 1:** prepare's stories recipe writes its one proving page story in the page shape: under `pages/`, a whole page at an address, named by place and state. One shared guide in the skill pack says how to write page stories and how to walk an app's navigation; prepare, planning's page rule and the mapping tickets all point at it. A project with stories but no page stories gets one map line: "No pages on the map yet".
- **Lap 2:** that empty state gains a **Map your app** door. It starts a feature whose planning walks the app's navigation with the guide and cards one ticket per area, the way this feature maps runcastle.

**Why:** A mapping pass is 40–80 stories of agent work, which is a feature's rounds, not a prepare step the human sits through on their own machine. Prepare keeps its one story as the proof the wiring works. The door sits where the gap shows. It is lap 2 because the guide should first be proven on runcastle's own app.
**Assumed.** Alternative: prepare runs the whole mapping pass itself, which needs no new door but turns a setup session into hours of story writing.

## 12. Scenarios move to the place they open on
**Decision:** In the mapping pass, each of runcastle's scenarios moves to the folder of the place it opens on, so it joins that page's group: the three under `scenarios/review/` move to `scenarios/feature/review/` in lap 1, beside `Feature/Review`. Scenario names, contents and the drive are unchanged.
**Why:** The map joins stories and scenarios by name (map decision 4). With groups now named after places, a scenario left in a code-shaped folder would form a lone group of ways in beside the page it belongs to. Moving files keeps the join without any new matching rule.
**Assumed.** Alternative: leave scenario folders alone and accept separate "Review" and "Feature › Review" groups until someone moves them.

## 13. Places are ordered as you move through the app, by their story folders
**Decision:**
- **Order:** places, in the overview and the sidebar tree, follow the paths of their page story files under `pages/`. The agent mapping an app numbers those folders in navigation order (`pages/1-onboarding/`, `pages/2-project-chooser/`, `pages/3-project/`, `pages/4-feature/1-planning/`, …).
- **Names stay clean:** the numbers live in the folders only, never in the titles the map shows.
- **Scenario-only groups** come after the places with pages, in today's order.

**Why:** The human lists runcastle as onboarding, then the project chooser, then the project session: how you move through the app, which alphabetical order breaks. Runcastle already reads each story's file path from the index, so ordering by it is text only, and it keeps the brief's names (`Onboarding`, not `1 Onboarding`). (A branch the challenge found.)
**Assumed.** Alternative: numbers in the place titles, as states have them, which is one rule for both but puts "1 Onboarding" in the sidebar.

---

# Re-scope after the lap-1 drive (2026-10-20)

Decided with the human, in a grilling after their lap-1 drive. **Decisions 1–13 above are superseded** except where a decision below keeps part of one; they stay as the record of lap 1.

The human, on what they wanted all along: "The reason I wanted these components showing in runcastle was so that I can iterate with the agent on specific components/screens/states without having to test drive everytime, reach that state, then see how it looks. This was my main issue. … No need to maintain the components in a map on the sidebar." And, on the proposed map redesign: "This feels complicated and over sophisticated. I dont want to have to deal with this."

## 14. This feature becomes a cleanup; the live preview is design mode's
**Decision:** Lap 2 removes what lap 1 and the two features before it built for the map and the story catalogue, and keeps only the plain code that renders the real app with fake data. The live preview beside the chat, where the human and the agent iterate on a state, is the draft *Design mode*, re-briefed the same day with everything decided here. This feature's title stays (features cannot be renamed); its brief says it was re-scoped.
**Why:** The cleanup is small and certain and removes code in the human's way now. Design mode has open questions of its own (installed dependencies in chat worktrees, code edits during planning, the dev server's lifecycle) that would otherwise hold the cleanup hostage.
**Chosen by the human.** Alternative: this feature becomes design mode, one bigger feature.

## 15. The map is removed
**Decision:** The Map tab and everything only it uses go: the map views and overview, `project.map` and its service, the core map model, `main`'s copy of the catalogue with its Build/Rebuild button and its promotion at merge, the map's doors into the drive ("Open in drive", "Try it", "New scenario" from the map), and the map's mentions in agents' feature context. Scenarios themselves stay: the Test drive picker and the running drive's Scenario menu list them, and the drive's API view runs calls. The lap-1 scenario folder move (`scenarios/review/` → `scenarios/feature/review/`, decision 12) is undone, and so is the "Map of this checkout" scenario.
**Chosen by the human** ("Remove it and any extra logic, components, etc.. that we don't need anymore. Clean things up").

## 16. Storybook and the story catalogue are removed
**Decision:** Runcastle stops building, serving and showing story catalogues:
- the review page's "UI states" section;
- the catalogue build at every review pass and the base build at the branch point;
- the stories port and its static serving;
- `.runcastle/stories.json` and everything that reads it (`stories.setUp`);
- prepare's stories setup;
- the planning rule that adds "ship a story" to tickets, the page rule (decision 10), and the stories notes in the burner and review prompts.

Runcastle's own repo drops Storybook: its packages, `.runcastle/storybook/` config and the story files under `.runcastle/stories/`.
**Why:** Stories existed to iterate with the agent; building them at review spends worker time and adds machinery to show something the review agent can capture instead. With no catalogue built anywhere, Storybook's only remaining job (rendering a state without the backend, with hot reload) is done by plain code plus the project's own dev server.
**Chosen by the human,** in three steps:
1. first keeping the review section with a gate that never fails;
2. then "What's the point of wasting implementation time and adding extra complexity to maintain it to show the story in review.. We can probably just make the review agent take captures of the screens";
3. then "Do we really need storybook with how simple things became?"

## 17. Screens at review come from the review agent's screenshots
**Decision:** Seeing screens at review is the job of *Review hands you a running drive with what it saw*: its "What the agent saw" section shows the screenshots the review agent takes per scenario and per check. Its brief and spec were amended the same day to say it is now the only view of screens at review. This feature builds nothing for it.
**Chosen by the human.**

## 18. The fake-data helpers survive as plain code under `.runcastle/preview/`
**Decision:** Four modules from lap 1 move out of `.runcastle/storybook/` into `.runcastle/preview/`, with every Storybook import removed:
- the fake network layer (`fake-api`: answers tRPC at the `fetch` edge, including the mutations a caller names);
- the faked session data (`shell-fakes`);
- the app-at-an-address helper (`app-at`);
- the silent live-stream stand-in.

They stay checked by `bun run typecheck` (its storybook tsconfig step becomes a preview one). Nothing else in runcastle uses them; they are design mode's starting point.
**Why:** Faking every query the shell and a page make was most of lap 1's work, and none of it is Storybook-specific. Deleting it would make design mode redo it.
**Assumed.** Alternative: delete them too and let design mode rewrite them.
