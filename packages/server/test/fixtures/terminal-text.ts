/**
 * Reduce raw terminal output to the text a reader sees, so a fixture can match
 * what a program printed. ConPTY redraws the screen rather than echoing bytes:
 * it may draw a space as a cursor-forward (`ESC[<n>C`) and sets the window
 * title with OSC sequences (`ESC]0;…BEL`). Cursor-forward becomes that many
 * spaces; every other CSI and every OSC is dropped.
 */
export function terminalText(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[(\d*)C/g, (_, n: string) => ' '.repeat(Number(n || '1')))
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
}
