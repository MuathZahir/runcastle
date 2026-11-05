import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Note {
  id: number
  body: string
  createdAt: string
}

export interface NotesStore {
  add(body: string): Note
  list(): Note[]
}

/** Opens (creating if needed) the notes database at `file`, or in memory for ':memory:'. */
export function openNotes(file: string): NotesStore {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  return {
    add(body) {
      const text = body.trim()
      if (text === '') throw new Error('a note cannot be empty')
      return db
        .query('INSERT INTO notes (body) VALUES (?) RETURNING id, body, created_at AS createdAt')
        .get(text) as Note
    },
    list() {
      return db
        .query('SELECT id, body, created_at AS createdAt FROM notes ORDER BY id DESC')
        .all() as Note[]
    },
  }
}
