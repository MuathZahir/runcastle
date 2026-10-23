## Purpose

The human feels the project sidebar's general feel can be improved: it should look less cluttered and a little more interesting. This feature reworks the project sidebar's look and layout to do both.

Today, top to bottom (apps/web/src/components/Sidebar.tsx, SidebarLanes.tsx): head (project switcher, Create menu, collapse button); search launcher; nav (Project row, plus a Preparation row while preparation is owed); the pinned Inbox lane (or a "Nothing needs you" row); the work lanes (Agent working · In progress · Drafts · Shipped capped with "Show all"), then "Show archived"; the foot (live project/feature drive rows, "N running elsewhere", "Re-prepare project", then the status line: server, sandbox, notifications, theme, settings).

Suspected sources of clutter, raised in intake and confirmed only loosely ("the general feel can be improved"), so the ideation session should test them with the human rather than take them as given:
- four or five lane headings with counts stacked even when a lane holds one row;
- the Shipped lane spending room on work rarely opened;
- the foot growing extra rows above its status line.

## Understood

- **Stay within the design rules.** apps/web/DESIGN.md's quiet-workbench rules still bind: one-line 32px rows, no chips/pills, colour only where it means something, shape before hue, icons with words. "More interesting" comes from what those rules allow: tighter grouping, quiet lanes that fold away, a calmer foot, live work that feels more alive, and so on. The human explicitly chose this over bending the rules (which would have been an app-wide visual rethink).
- **Show directions first.** The session should open by rendering two or three distinct directions as live previews (design mode) and let the human react to pictures before any decision locks.
- **One feature**, sized for one ideation session.

## Must not swallow

- Other pages (feature page, project home, settings, etc.).
- The design guide's general rules. Only DESIGN.md's sidebar-specific parts (Frame section, NavItem/SectionLabel notes) may be amended to describe the new sidebar.
- New sidebar behaviour or data: no new lanes, actions or destinations. This is look and layout of what is already there. (Reordering, folding or regrouping existing items is in scope.)

The foot's status line (SidebarFootChrome) is shared with the all-projects home sidebar, so changes there show on that screen too. That is expected and fine.

## Open

- Which specific parts bother the human most. Ask, and let the previews draw it out.
- What "more interesting" means to them in practice. Let them pick among the preview directions.

## Ordering

Standalone. No sibling features from this cut, nothing in flight touches the sidebar files, and nothing waits on it.
