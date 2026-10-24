export function countDecisions(markdown: string): number {
  return markdown.split(/\r?\n/).filter((line) => line.startsWith('## ')).length
}
