// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Effort, ModelChoice } from '../src/lib/chat-thread'
import { ModelControls } from '../src/components/chat/thread/ComposerParts'
import { pickOption } from './floating'

/**
 * The composer's model controls (chat-as-web-components decision 13): one
 * searchable list grouped by family, newest first, older versions folded;
 * effort and fast mode as their own controls, each offered only where the
 * model has it.
 */

const ALL: Effort[] = ['low', 'medium', 'high', 'max']
const CLAUDE: ModelChoice[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Most capable for complex work', efforts: ALL, fast: true },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Best for everyday tasks', efforts: ['low', 'medium', 'high'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [] },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', note: 'opus 4.8 — UI work' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-5', label: 'Opus 5' },
]

function controls(over: Partial<Parameters<typeof ModelControls>[0]> = {}) {
  const props = {
    runtime: 'claude-code' as const,
    models: CLAUDE,
    model: 'claude-opus-5-5',
    onModel: vi.fn(),
    effort: 'high' as Effort | undefined,
    onEffort: vi.fn(),
    fast: false,
    onFast: vi.fn(),
    ...over,
  }
  render(<ModelControls {...props} />)
  return props
}

const openPicker = () => fireEvent.click(screen.getByRole('button', { name: 'Model' }))
const shown = () => screen.getAllByRole('option').map((o) => o.textContent)

afterEach(cleanup)

describe('the model picker', () => {
  it('names the model alone on its chip', () => {
    controls()
    expect(screen.getByRole('button', { name: 'Model' }).textContent).toBe('Opus 5.5')
  })

  it('groups the latest of each family, most capable family first, and folds the older versions', () => {
    controls()
    openPicker()
    const groups = screen.getAllByRole('group').map((g) => within(g).getAllByRole('option').map((o) => o.textContent))
    expect(groups).toEqual([['Fable 5.1'], ['Opus 5.5Most capable for complex work'], ['Sonnet 5.5Best for everyday tasks'], ['Haiku 4.5']])
    expect(shown()).not.toContain('Opus 4.8opus 4.8 — UI work')

    fireEvent.click(screen.getByRole('option', { name: /Older models/ }))
    const older = screen.getByRole('group', { name: 'Older models' })
    expect(within(older).getAllByRole('option').map((o) => o.textContent)).toEqual(['Opus 5', 'Opus 4.8opus 4.8 — UI work', 'Sonnet 4.6'])
    // Unfolding is not a pick: the list stays open.
    expect(screen.getByRole('listbox', { name: 'Models' })).toBeTruthy()
  })

  it('checks the current model, and opens with an older one in view when the thread is on it', () => {
    controls({ model: 'claude-opus-4-8' })
    openPicker()
    expect(screen.getByRole('option', { name: /Opus 4.8/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('option', { name: /Opus 5.5/ }).getAttribute('aria-current')).toBeNull()
  })

  it('filters as the search is typed, older versions included', () => {
    controls()
    openPicker()
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'opus' } })
    expect(shown()).toEqual(['Opus 5.5Most capable for complex work', 'Opus 5', 'Opus 4.8opus 4.8 — UI work'])
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'gemini' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No model matches.')).toBeTruthy()
  })

  it('picks with the arrows and Enter, and closes', () => {
    const { onModel } = controls()
    openPicker()
    const search = screen.getByLabelText('Search models')
    fireEvent.change(search, { target: { value: 'sonnet' } })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onModel).toHaveBeenCalledWith('claude-sonnet-4-6')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('groups Codex models by GPT generation, the newest version’s variants in view', () => {
    controls({
      runtime: 'codex',
      model: 'gpt-5.5',
      models: [
        { id: 'gpt-5.4', label: '5.4' },
        { id: 'gpt-5.5', label: '5.5' },
        { id: 'gpt-5.5-mini', label: '5.5 Mini' },
        { id: 'gpt-5.3-codex', label: '5.3 Codex' },
      ],
    })
    openPicker()
    const group = screen.getByRole('group', { name: 'GPT-5' })
    expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual(['5.5', '5.5 Mini'])
    fireEvent.click(screen.getByRole('option', { name: /Older models/ }))
    expect(within(screen.getByRole('group', { name: 'Older models' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['5.4', '5.3 Codex'])
  })

  it('keeps the search focused when the older models unfold', () => {
    controls()
    openPicker()
    const search = screen.getByLabelText('Search models')
    search.focus()
    fireEvent.mouseDown(screen.getByRole('option', { name: /Older models/ }))
    expect(document.activeElement).toBe(search)
  })
})

describe('effort and fast mode', () => {
  it('offers only the levels the model takes, beside the model', () => {
    const { onEffort } = controls({ model: 'claude-sonnet-5-5' })
    const trigger = screen.getByRole('combobox', { name: 'Effort' })
    expect(trigger.textContent).toContain('High')
    fireEvent.click(trigger)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Low', 'Medium', 'High'])
    fireEvent.click(screen.getByRole('option', { name: 'Low' }))
    expect(onEffort).toHaveBeenCalledWith('low')
  })

  it('shows the recommended level when the model does not take the one held', () => {
    controls({ model: 'claude-sonnet-5-5', effort: 'max' })
    expect(screen.getByRole('combobox', { name: 'Effort' }).textContent).toContain('Medium')
  })

  it('has no effort control for a model that takes none, or whose levels are not known yet', () => {
    controls({ model: 'claude-haiku-4-5' })
    expect(screen.queryByRole('combobox', { name: 'Effort' })).toBeNull()
    cleanup()
    controls({ model: 'claude-fable-5-1' })
    expect(screen.queryByRole('combobox', { name: 'Effort' })).toBeNull()
  })

  it('offers a fast mode toggle only where the model has it', () => {
    const { onFast } = controls()
    const toggle = screen.getByRole('button', { name: 'Fast mode' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(onFast).toHaveBeenCalledWith(true)
    cleanup()
    controls({ model: 'claude-sonnet-5-5' })
    expect(screen.queryByRole('button', { name: 'Fast mode' })).toBeNull()
  })

  it('picks an effort through the Select like any other', () => {
    const { onEffort } = controls()
    pickOption(screen.getByRole('combobox', { name: 'Effort' }), 'Max')
    expect(onEffort).toHaveBeenCalledWith('max')
  })
})
