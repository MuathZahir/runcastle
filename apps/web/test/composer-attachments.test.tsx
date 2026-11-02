// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../src/components/chat/thread/Composer'
import { ToastProvider } from '../src/lib/toast'

/**
 * The chat box takes only pictures, and says which files it left out
 * (small-fixes-before-publish decision 11) instead of dropping them silently.
 */

afterEach(cleanup)

const png = () => new File(['png'], 'shot.png', { type: 'image/png' })
const pdf = () => new File(['pdf'], 'notes.pdf', { type: 'application/pdf' })

function composer() {
  const onAttach = vi.fn()
  render(
    <ToastProvider>
      <Composer value="" onChange={() => {}} state="idle" onSend={() => {}} onAttach={onAttach} />
    </ToastProvider>,
  )
  return onAttach
}

describe('the chat box attachments', () => {
  it('a picked PNG and PDF: attaches the PNG and names the PDF it left out', () => {
    const onAttach = composer()
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(picker, { target: { files: [png(), pdf()] } })

    expect(onAttach).toHaveBeenCalledTimes(1)
    expect(onAttach.mock.calls[0]?.[0].map((f: File) => f.name)).toEqual(['shot.png'])
    expect(screen.getByText('Only pictures can be attached: notes.pdf was left out')).toBeTruthy()
  })

  it('a pasted PNG and PDF: attaches the PNG and names the PDF; a PDF alone stays a text paste', () => {
    const onAttach = composer()
    const box = screen.getByRole('textbox')
    const pasted = fireEvent.paste(box, { clipboardData: { files: [png(), pdf()] } })

    expect(pasted).toBe(false) // the picture was taken, so the paste is handled
    expect(onAttach.mock.calls[0]?.[0].map((f: File) => f.name)).toEqual(['shot.png'])
    expect(screen.getByText('Only pictures can be attached: notes.pdf was left out')).toBeTruthy()

    expect(fireEvent.paste(box, { clipboardData: { files: [pdf()] } })).toBe(true)
    expect(onAttach).toHaveBeenCalledTimes(1)
  })
})
