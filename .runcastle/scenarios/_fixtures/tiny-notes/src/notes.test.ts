import { expect, test } from 'bun:test'
import { openNotes } from './notes.ts'

test('a stored note comes back newest first', () => {
  const store = openNotes(':memory:')
  store.add('first')
  store.add('second')
  expect(store.list().map((n) => n.body)).toEqual(['second', 'first'])
})

test('an empty note is refused', () => {
  expect(() => openNotes(':memory:').add('   ')).toThrow('empty')
})
