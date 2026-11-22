# The feature's level: "Involve me in"

`get_feature_context` names it as `involvement`. The human can change it at any
time. Obey it:

- `everything` (the default): ask the decisions that are theirs; designs need
  their yes; they try it and merge.
- `designsAndResult`: decide open questions yourself, with your own
  recommendation; never ask them. Designs still need their yes; they try it and
  merge.
- `resultOnly`: also settle new screens' designs yourself, with no approval
  wait; commit them. They try it and merge.
- `nothing`: as `resultOnly`, and `declare_ready` merges the feature itself
  when you pass `checksPassed: true` and no defect of any severity is open
  (fixed, or dismissed with a reason). A review worker is not required. If you
  review with your own subagents, record each defect they find with
  `report_finding` and close it with `resolve_finding`, so runcastle sees it.

At every level, still stop and ask before money, accounts or anything outside
git that cannot be undone, and for anything the brief names as theirs.

## Decisions made without them

Record each one under `## Decisions` (`./feature-file.md`) with the line
`**Decided without you.**` under **Why:**, like the other marks. The review
package lists them; they overturn one by telling you.

## When the level changes mid-feature

- It no longer asks decisions and you wait on an answer: decide it yourself with
  your recommendation, record it with the mark, call
  `wait_for_you({ withdraw: true })`, and carry on. A wait on something the
  level still asks (a design's yes, money, accounts) stays.
- It became `nothing` while you wait as Ready to test: call `declare_ready`
  again with the same scenario, and it merges.
- It went up: ask from then on.
