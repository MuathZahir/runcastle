/**
 * The `post-commit` sync hook, read back out of a setup command.
 *
 * Both repo-setup builders (`buildIsolatedSetupCommand`,
 * `buildSlotSetupCommand`) deliver the hook as a single
 * `printf '%s\n' '<line>' '<line>' … > <hook>`, every line a single-quoted
 * word — so nothing in it is interpreted while the hook is written, and the
 * command string alone does not show what lands on disk. This reverses that
 * delivery (unquote each word, one line per word) and hands back the hook
 * script as the agent's shell writes it, so tests can assert on the hook's
 * behaviour rather than on its packaging.
 */
export function postCommitHookBody(setupCommand: string): string {
  const open = `printf '%s\\n' '#!/bin/sh'`
  const start = setupCommand.indexOf(open)
  if (start === -1) throw new Error('setup command writes no post-commit hook')
  const lines: string[] = []
  let i = start + `printf '%s\\n' `.length
  while (setupCommand[i] === "'") {
    let word = ''
    for (;;) {
      const close = setupCommand.indexOf("'", i + 1)
      if (close === -1) throw new Error('unterminated hook line')
      word += setupCommand.slice(i + 1, close)
      // `'\''` — a literal quote, and the same word goes on.
      if (setupCommand.startsWith(`\\''`, close + 1)) {
        word += "'"
        i = close + 3
        continue
      }
      i = close + 1
      break
    }
    lines.push(word)
    if (setupCommand[i] === ' ') i++
  }
  if (!setupCommand.startsWith('> ', i)) throw new Error('hook lines are not written to a file')
  return `${lines.join('\n')}\n`
}
