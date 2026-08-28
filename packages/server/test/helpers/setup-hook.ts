/**
 * The `post-commit` sync hook, read back out of a setup command.
 *
 * Both repo-setup builders (`buildIsolatedSetupCommand`,
 * `buildSlotSetupCommand`) deliver the hook as a single `printf` with the temp
 * branch passed as ARGS — so the branch is never shell-interpreted, and the
 * command string alone does not show what the agent's shell actually writes.
 * This reverses that delivery: unescape the format string, substitute `%s`, and
 * hand back the hook script as it lands on disk, so tests can assert on the
 * hook's behaviour rather than on its packaging.
 */
export function postCommitHookBody(setupCommand: string, branch: string): string {
  const open = `printf '#!/bin/sh`
  const start = setupCommand.indexOf(open)
  if (start === -1) throw new Error('setup command writes no post-commit hook')
  const from = start + `printf '`.length
  const end = setupCommand.indexOf(`' '${branch}'`, from)
  if (end === -1) throw new Error('post-commit hook does not take the branch as a printf arg')
  return setupCommand.slice(from, end).replace(/\\n/g, '\n').replaceAll('%s', branch)
}
