// @vitest-environment happy-dom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../src/ui'
import { useHistorySync } from '../src/lib/use-history-sync'
import type { AppLocation } from '../src/lib/routes'
import { atWidth } from './phone-width'

/**
 * Phone fixes decisions 2, 3 and 5: Back walks out one level at a time. Tier 2
 * on happy-dom's own back stack, whose Back lands asynchronously with each
 * entry's state, as a browser's does — the shape of the stack is the thing
 * under test, so nothing of `history` is stubbed.
 */

const PROJECT: AppLocation = { kind: 'project', projectId: 'p1' }
const CHAT: AppLocation = { kind: 'feature', projectId: 'p1', featureSlug: 'alpha', view: 'chat' }
const PLAN: AppLocation = { kind: 'feature', projectId: 'p1', featureSlug: 'alpha', view: 'plan' }
const BETA: AppLocation = { kind: 'feature', projectId: 'p1', featureSlug: 'beta', view: 'chat' }

/** A page whose location the buttons move, with one dialog over it. */
function Page({ dirty = false }: { dirty?: boolean }) {
  const [location, setLocation] = useState<AppLocation>(PROJECT)
  const [open, setOpen] = useState(false)
  useHistorySync(location, (popped) => popped && setLocation(popped))
  return (
    <>
      <button onClick={() => setLocation(CHAT)}>chat</button>
      <button onClick={() => setLocation(PLAN)}>plan</button>
      <button onClick={() => setLocation(BETA)}>beta</button>
      <button onClick={() => setOpen(true)}>open dialog</button>
      <Dialog open={open} onClose={() => setOpen(false)} label="Overlay" dirty={dirty}>
        <button onClick={() => setOpen(false)}>close</button>
        <button
          onClick={() => {
            // A sheet row: close, then go somewhere, in one tap.
            setOpen(false)
            setLocation(PLAN)
          }}
        >
          close and open plan
        </button>
      </Dialog>
    </>
  )
}

const tap = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const path = () => window.location.pathname
const settle = () => act(() => new Promise((done) => setTimeout(done, 20)))

async function back(lands: string) {
  await act(async () => {
    window.history.back()
    await new Promise((done) => setTimeout(done, 20))
  })
  await waitFor(() => expect(path()).toBe(lands))
}

beforeEach(async () => {
  window.history.replaceState(null, '', '/start')
  window.history.pushState(null, '', '/p/p1')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('closing a view (decisions 2, 5)', () => {
  it('steps back to the chat it came from, so Back never reopens the view', async () => {
    atWidth(false)
    render(<Page />)
    tap('chat')
    tap('plan')
    expect(path()).toBe('/p/p1/f/alpha/plan')
    tap('chat') // the panel closes
    await settle()
    expect(path()).toBe('/p/p1/f/alpha/chat')
    await back('/p/p1')
  })

  it('still pushes a move to another page, even one the entry behind names', async () => {
    atWidth(false)
    render(<Page />)
    tap('chat')
    tap('beta')
    const depth = window.history.length
    tap('chat')
    await settle()
    expect(path()).toBe('/p/p1/f/alpha/chat')
    expect(window.history.length).toBe(depth + 1)
    await back('/p/p1/f/beta/chat')
  })
})

describe('an overlay on the phone (decision 3)', () => {
  it('takes one Back step: Back closes it, then leaves the page', async () => {
    atWidth(true)
    render(<Page />)
    tap('chat')
    tap('open dialog')
    await settle()
    expect(screen.getByRole('dialog', { name: 'Overlay' })).toBeTruthy()
    await back('/p/p1/f/alpha/chat')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await back('/p/p1')
  })

  it('steps off its entry when closed by its own button, so Back never brings it back', async () => {
    atWidth(true)
    render(<Page />)
    tap('chat')
    tap('open dialog')
    await settle()
    tap('close')
    await settle()
    expect(path()).toBe('/p/p1/f/alpha/chat')
    await back('/p/p1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lands the step off before the place a row goes to, so Back goes there → chat → list', async () => {
    atWidth(true)
    render(<Page />)
    tap('chat')
    tap('open dialog')
    await settle()
    tap('close and open plan')
    await settle()
    expect(path()).toBe('/p/p1/f/alpha/plan')
    await back('/p/p1/f/alpha/chat')
    expect(screen.queryByRole('dialog')).toBeNull()
    await back('/p/p1')
  })

  it('asks before Back throws away what was typed, and keeps its step', async () => {
    atWidth(true)
    render(<Page dirty />)
    tap('chat')
    tap('open dialog')
    await settle()
    await back('/p/p1/f/alpha/chat')
    expect(await screen.findByText('Discard what you have typed?')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Overlay' })).toBeTruthy()
    await settle()
    // Kept: Back still closes it rather than leaving the page.
    await back('/p/p1/f/alpha/chat')
    expect(screen.getByRole('dialog', { name: 'Overlay' })).toBeTruthy()
  })

  it('steps over an overlay entry with no overlay open', async () => {
    atWidth(true)
    render(<Page />)
    tap('chat')
    await settle()
    // What a reload over an open sheet leaves, then a page opened above it.
    act(() => window.history.pushState({ runcastle: true, overlay: 'gone', from: '/p/p1/f/alpha/chat' }, '', '/p/p1/f/alpha/chat'))
    tap('plan')
    await settle()
    await back('/p/p1/f/alpha/chat')
    await settle()
    await back('/p/p1')
  })

  it('takes no history entry on the desktop', async () => {
    atWidth(false)
    render(<Page />)
    tap('chat')
    const depth = window.history.length
    tap('open dialog')
    await settle()
    expect(window.history.length).toBe(depth)
  })
})
