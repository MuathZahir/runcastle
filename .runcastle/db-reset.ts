/**
 * Reset the dev database: delete the dev server's database files so the next
 * start migrates a fresh one. It is a script so the same command works on every
 * system a project moves to.
 */
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.runcastle-dev')
for (const name of ['runcastle.db', 'runcastle.db-wal', 'runcastle.db-shm']) {
  rmSync(join(dir, name), { force: true })
}
console.log(`Reset the dev database in ${dir}`)
