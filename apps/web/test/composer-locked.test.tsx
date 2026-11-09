// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../src/components/chat/thread/Composer'
import { ModelControls } from '../src/components/chat/thread/ComposerParts'
import type { ModelChoice } from '../src/lib/chat-thread'
import { ToastProvider } from '../src/lib/toast'
import { pickOption } from './floating'

/**
 * A locked composer (a-new-feature-waits-for-start decision 7): the box takes
 * nothing and says why, Send stays off, and the model controls under it still
 * work, so the model is chosen before Start.
 */

afterEach(cleanup)

const MODELS: ModelChoice[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high'], fast: true },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], fast: true },
]

function locked(value = '') {
  const onChange = vi.fn()
  const onSend = vi.fn()
  const onAttach = vi.fn()
  const onModel = vi.fn()
  const onEffort = vi.fn()
  const onFast = vi.fn()
  render(
    <ToastProvider>
      <Composer
        value={value}
        onChange={onChange}
        state="idle"
        onSend={onSend}
        onAttach={onAttach}
        commands={[{ name: 'review', description: 'Review the diff' }]}
        locked
        footer={
          <ModelControls
            runtime="claude-code"
            models={MODELS}
            model="claude-opus-5-5"
            onModel={onModel}
            effort="high"
            onEffort={onEffort}
            fast={false}
            onFast={onFast}
          />
        }
      />
    </ToastProvider>,
  )
  return { onChange, onSend, onAttach, onModel, onEffort, onFast }
}

const box = () => screen.getByLabelText('Message') as HTMLTextAreaElement
const send = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement

describe('a locked composer', () => {
  it('takes no input and says why', () => {
    const { onChange, onAttach } = locked()
    expect(box().disabled).toBe(true)
    expect(box().placeholder).toBe('Start the agent first — it opens the conversation')
    fireEvent.paste(box(), { clipboardData: { files: [new File(['png'], 'shot.png', { type: 'image/png' })] } })
    expect(onAttach).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Attach images' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps Send off, even over words left from before, and opens no command menu', () => {
    const { onSend } = locked('/rev')
    expect(send().disabled).toBe(true)
    fireEvent.click(send())
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.queryByText('Review the diff')).toBeNull()
  })

  it('keeps the model, effort and fast controls working', () => {
    const { onModel, onEffort, onFast } = locked()
    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    fireEvent.click(screen.getByRole('option', { name: /Sonnet 5.5/ }))
    expect(onModel).toHaveBeenCalledWith('claude-sonnet-5-5')
    pickOption(screen.getByRole('combobox', { name: 'Effort' }), 'Low')
    expect(onEffort).toHaveBeenCalledWith('low')
    fireEvent.click(screen.getByRole('button', { name: 'Fast mode' }))
    expect(onFast).toHaveBeenCalledWith(true)
  })
})
