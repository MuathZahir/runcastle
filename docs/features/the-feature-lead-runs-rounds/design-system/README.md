# Runcastle Design System — reading copy

A copy of the `project/` files of the human's **Runcastle Design System** artifact
(https://claude.ai/artifact/JK4Nbts5BetjWU6bJsWPkn, version 1792227582-cea5, pulled
2026-10-17), so burn workers — who cannot reach claude.ai from their sandboxes — can
read it. Start at `project/README.md` (the brand book), then `project/tokens.json`,
then the component you are building under `project/components/<Name>/`
(`README.md` for the rules, `preview.html` for the reference markup; `FeaturePage`
is the feature-page showcase).

Order of authority when they disagree: `apps/web/DESIGN.md` and `apps/web/STYLE.md`
in the repo, then this copy, then `../frontend-design/SKILL.md`. The frontend-design
skill is for craft and self-critique; it does not license a new palette, typeface or
look — runcastle's visual direction is already pinned.

The mocks in `../preview.html` explain behaviour, not styling: its chips, pills and
left-border cards are exactly what this design system retires.
