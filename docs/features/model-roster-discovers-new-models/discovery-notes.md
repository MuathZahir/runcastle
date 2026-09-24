# Model discovery observations

Verified against `@anthropic-ai/claude-agent-sdk` 0.3.281 and its installed TypeScript declarations:

- `query` accepts an `AsyncIterable<SDKUserMessage>` for streaming input, and the executable override is named `options.pathToClaudeCodeExecutable`.
- `initializationResult()` returns the account-aware `models` array before any user prompt is submitted, and `Query.close()` forcefully cleans up the CLI subprocess and other resources.
- A live sandbox probe supplied an empty input iterable, read initialization successfully, called `close()`, and exited cleanly. It returned pinned ids for Sonnet 5, Fable 5.1, Opus 5.5, and Haiku 4.5.
- The returned list had no separate `[1m]` variants. The aliases in that response resolved to pinned ids without a `[1m]` suffix, so curated `[1m]` entries remain necessary on this account.

The SDK probe made no prompt submission and therefore no model turn was requested. Billing itself was not independently observable in this sandbox, so the stronger claim that initialization can never incur an account-side charge remains unverified.
