/**
 * The linking rule every runcastle agent carries word for word
 * (chats-link-to-what-they-name decision 6): the orchestrator's, the lead's and
 * the Q&A skills hold the same paragraph, every worker's briefing ends its
 * how-you-work with it, and a test keeps the copies identical. The web renders
 * `feature:` and `worker:` link targets as links that open the thing in place.
 */
export const LINK_WHAT_YOU_NAME =
  "**Link what you name.** When you point the human at a feature, a worker or a feature's plan or designs, write it as a link: `[Faster reviews](feature:faster-cheaper-reviews)`, `feature:<slug>/plan`, `feature:<slug>/design`, `[Header](worker:<worker id>)`. Use only a slug or worker id a runcastle tool gave you, never a guess: a link to nothing shows as plain text."
