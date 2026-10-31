/**
 * How a terminal's `(file, args)` becomes the one command-line string Windows
 * hands a process.
 *
 * `Bun.spawn` can do this itself, but it escapes an embedded `"` as `\"`, which
 * `cmd.exe` does not read: `cmd /d /s /c "a b.cmd" "two words"` arrives mangled.
 * So the terminal backend builds the line here and spawns with
 * `windowsVerbatimArguments`, which takes it as written.
 *
 * Pure, so it is testable on every OS.
 */

/** Quote one argument by the `CommandLineToArgvW` rules every C runtime parses with. */
function quoteArgument(arg: string): string {
  const quoted = arg.startsWith('"') && arg.endsWith('"') && arg.length > 1
  const quote = arg === '' || (/[ \t]/.test(arg) && arg.length > 1 && !quoted)

  let result = quote ? '"' : ''
  let backslashes = 0
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++
    } else if (ch === '"') {
      result += `${'\\'.repeat(backslashes * 2 + 1)}"`
      backslashes = 0
    } else {
      result += '\\'.repeat(backslashes) + ch
      backslashes = 0
    }
  }
  return quote ? `${result}${'\\'.repeat(backslashes * 2)}"` : result + '\\'.repeat(backslashes)
}

/**
 * The `cmd.exe /d /s /c <line>` shim (`devSpawnTarget`, `imageBuildTerminal`).
 * `/s` strips the first and last quote of what follows and takes the rest
 * literally, so the line goes in whole between one outer pair. Escaping it as an
 * ordinary argument is exactly what breaks a command that quotes things.
 */
function shimLine(args: string[]): string | null {
  const [d, s, c, line, ...rest] = args
  if (d !== '/d' || s !== '/s' || c !== '/c' || line === undefined || rest.length > 0) return null
  return `/d /s /c "${line}"`
}

/** Everything after the program on the command line. */
export function windowsArgsLine(args: string[]): string {
  return shimLine(args) ?? args.map(quoteArgument).join(' ')
}

/** The whole command line: the program, quoted as its first argument, then its args. */
export function windowsCommandLine(file: string, args: string[]): string {
  return [quoteArgument(file), windowsArgsLine(args)].filter(Boolean).join(' ')
}

/** The program as `argv0`, which verbatim spawning does not quote for us. */
export function windowsArgv0(file: string): string {
  return quoteArgument(file)
}
