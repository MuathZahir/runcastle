// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NewChatCard } from '../src/components/ProjectWorkspace'

describe('the New chat door with a live chat', () => {
  afterEach(cleanup)

  it('offers and performs both inline choices', () => {
    let opened = 0
    let replaced = 0
    render(
      <NewChatCard
        onStart={() => {}}
        starting={false}
        openSession={{ onOpen: () => opened++, onReplace: () => replaced++ }}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('A chat is already open.')
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }))
    fireEvent.click(screen.getByRole('button', { name: 'End it and start new' }))
    expect({ opened, replaced }).toEqual({ opened: 1, replaced: 1 })
  })
})
