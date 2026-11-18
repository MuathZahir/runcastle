# Decisions: Sessions never pick up a project's API key

## 1. Block only .env
**Decision:** Runcastle never loads an Anthropic key from a `.env` file, in any process it starts. A key the human deliberately exports in their own shell keeps working, so a user who bills an API key on purpose is not broken.
**Why:** The leak comes from Bun reading `.env` files on its own; a shell export is a choice the human made.

## 2. Make sure it doesn't happen again
**Decision:** The fix comes with checks that fail loudly if a future change brings the leak back, not just a one-time patch.
**Why:** The human's words: "MAKE SURE THIS DOESNT HAPPEN AGAIN".
