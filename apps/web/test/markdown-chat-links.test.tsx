// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Markdown } from '../src/components/Markdown'
import { ChatLinksContext, type ChatLinks, type WorkerPlace } from '../src/components/chat/ChatLink'

/**
 * Links an agent writes in its chat (chats-link-to-what-they-name): the one
 * markdown component, with a fake of the links the project shell provides.
 */

afterEach(cleanup)

const PLACES: Record<string, WorkerPlace> = { w1: { featureId: 'f2', slug: 'header' } }

function fakeLinks() {
  return {
    projectId: 'p1',
    features: [
      { id: 'f1', slug: 'faster-reviews' },
      { id: 'f2', slug: 'header' },
    ],
    openFeature: vi.fn<ChatLinks['openFeature']>(),
    openWorker: vi.fn<ChatLinks['openWorker']>(),
    useWorkerPlace: (projectId: string, id: string): WorkerPlace | null => (projectId === 'p1' ? PLACES[id] ?? null : null),
  } satisfies ChatLinks
}

function show(source: string, links: ChatLinks | null) {
  return render(
    <ChatLinksContext.Provider value={links}>
      <Markdown source={source} breaks />
    </ChatLinksContext.Provider>,
  )
}

describe('a feature link', () => {
  it("carries the feature's address and opens it in place on a plain click", () => {
    const links = fakeLinks()
    show('See [Faster reviews](feature:faster-reviews).', links)
    const a = screen.getByRole('link', { name: 'Faster reviews' })
    expect(a.getAttribute('href')).toBe('/p/p1/f/faster-reviews')
    const plain = fireEvent.click(a)
    expect(plain).toBe(false) // default prevented
    expect(links.openFeature).toHaveBeenCalledWith('f1', undefined)
  })

  it('leaves a modified or middle click to the browser', () => {
    const links = fakeLinks()
    show('[Faster reviews](feature:faster-reviews)', links)
    const a = screen.getByRole('link', { name: 'Faster reviews' })
    expect(fireEvent.click(a, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(a, { metaKey: true })).toBe(true)
    expect(fireEvent.click(a, { shiftKey: true })).toBe(true)
    expect(fireEvent.click(a, { button: 1 })).toBe(true)
    expect(links.openFeature).not.toHaveBeenCalled()
  })

  it('opens the Design tab it names, and an old Plan link on Details', () => {
    const links = fakeLinks()
    show('[its plan](feature:faster-reviews/plan) and [the designs](feature:header/design)', links)
    const plan = screen.getByRole('link', { name: 'its plan' })
    const design = screen.getByRole('link', { name: 'the designs' })
    expect(plan.getAttribute('href')).toBe('/p/p1/f/faster-reviews/details')
    expect(design.getAttribute('href')).toBe('/p/p1/f/header/design')
    fireEvent.click(plan)
    fireEvent.click(design)
    expect(links.openFeature.mock.calls).toEqual([
      ['f1', 'details'],
      ['f2', 'design'],
    ])
  })
})

describe('a worker link', () => {
  it("opens the worker's chat in its feature, at that chat's address", () => {
    const links = fakeLinks()
    show('[the Header worker](worker:w1) is waiting', links)
    const a = screen.getByRole('link', { name: 'the Header worker' })
    expect(a.getAttribute('href')).toBe('/p/p1/f/header/chat?thread=w1')
    fireEvent.click(a)
    expect(links.openWorker).toHaveBeenCalledWith('f2', 'w1')
  })

  it('reads as plain text while it does not resolve', () => {
    show('[a worker](worker:gone) here', fakeLinks())
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('a worker here')).toBeTruthy()
  })
})

describe('a link that does not resolve', () => {
  it.each([
    ['an unknown slug', '[Nope](feature:no-such-thing)'],
    ['a malformed target', '[Nope](feature:faster-reviews/drive)'],
    ['an empty target', '[Nope](feature:)'],
  ])('reads %s as its words, with no link', (_, source) => {
    show(`${source} again`, fakeLinks())
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.querySelector('a')).toBeNull()
    expect(screen.getByText('Nope again')).toBeTruthy()
  })

  it('reads as its words with no links to resolve against', () => {
    show('[Faster reviews](feature:faster-reviews) and [w](worker:w1)', null)
    expect(document.querySelector('a')).toBeNull()
    expect(screen.getByText('Faster reviews and w')).toBeTruthy()
  })
})

it('leaves a web link as it was', () => {
  const links = fakeLinks()
  show('[the docs](https://example.com/docs)', links)
  const a = screen.getByRole('link', { name: 'the docs' })
  expect(a.getAttribute('href')).toBe('https://example.com/docs')
  expect(fireEvent.click(a)).toBe(true)
  expect(links.openFeature).not.toHaveBeenCalled()
})
