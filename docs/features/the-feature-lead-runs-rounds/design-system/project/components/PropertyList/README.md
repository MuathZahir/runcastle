# PropertyList

Key–value facts about the current object, in two quiet columns: keys `text-tertiary`, values `text` with a leading glyph.

**Consumer provides** `items`: `{label, value, sub?, phase? | tone? | icon?, mono?}`. Set `mono` only for code-shaped values (branch, path, sha).

**Replaces** rows of outlined status pills ("Reviewed ✓ · this build", "2/3 checks passed", "never test-driven", "succeeded"): each pill becomes a property with a dot and plain words.
