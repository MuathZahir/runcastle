// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field } from '../src/ui'

/**
 * A field is one thing, not a label near an input near two paragraphs. Tier 2
 * because what is asserted here is the wiring a screen reader follows — the
 * generated ids and what points at them — which only exists once the markup is
 * a document.
 */
describe('Field', () => {
  afterEach(cleanup)

  it('names the control by wiring the label to it', () => {
    render(
      <Field label="Base branch">
        <input />
      </Field>,
    )

    expect(screen.getByLabelText('Base branch').tagName).toBe('INPUT')
  })

  it('points the control at its help and its error', () => {
    render(
      <Field label="Base branch" help="Where this feature forks from." error="Pick a branch.">
        <input />
      </Field>,
    )

    const control = screen.getByLabelText('Base branch')
    const described = control.getAttribute('aria-describedby')!.split(' ')

    expect(described).toHaveLength(2)
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Where this feature forks from.',
      'Pick a branch.',
    ])
  })

  it('describes nothing when there is nothing to describe', () => {
    render(
      <Field label="Base branch">
        <input />
      </Field>,
    )

    expect(screen.getByLabelText('Base branch').getAttribute('aria-describedby')).toBeNull()
  })

  it('announces the error', () => {
    render(
      <Field label="Base branch" error="Pick a branch.">
        <input />
      </Field>,
    )

    expect(screen.getByRole('alert').textContent).toBe('Pick a branch.')
  })

  it('follows an id already on the control rather than renaming it', () => {
    render(
      <Field label="Base branch" htmlFor="base-branch">
        <input id="mine" />
      </Field>,
    )

    expect(screen.getByLabelText('Base branch').id).toBe('mine')
  })

  it('takes the id it was given when the control has none', () => {
    render(
      <Field label="Base branch" htmlFor="base-branch">
        <input />
      </Field>,
    )

    expect(screen.getByLabelText('Base branch').id).toBe('base-branch')
  })
})
