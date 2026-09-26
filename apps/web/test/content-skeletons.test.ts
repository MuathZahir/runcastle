import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FeatureRowsSkeleton } from '../src/components/Sidebar'
import { ProjectsSkeleton } from '../src/components/Shell'
import { SettingsSkeleton } from '../src/components/settings/GeneralPage'
import { DetailsSkeleton } from '../src/components/inspector/Inspector'
import { ProseSkeleton } from '../src/components/bodies/grill/ArtifactPane'
import { PreparationSkeleton } from '../src/components/PreparationWorkspace'

/**
 * Every content area loads as a skeleton shaped like what it is loading — not
 * a spinner and a word — announced by what it is loading, and waiting 300ms so
 * a fast load shows nothing at all.
 */
const render = (component: FunctionComponent) => renderToStaticMarkup(createElement(component))
const count = (html: string, marker: string) => html.split(`data-skeleton="${marker}"`).length - 1

const SITES: Array<[string, string, string]> = [
  ['the sidebar', render(FeatureRowsSkeleton), 'Loading features…'],
  ['the first load', render(ProjectsSkeleton), 'Loading projects…'],
  ['the general settings', render(SettingsSkeleton), 'Loading settings…'],
  ['the details aside', render(DetailsSkeleton), 'Loading the details…'],
  ['an artifact pane', renderToStaticMarkup(createElement(ProseSkeleton, { label: 'Loading spec.md…' })), 'Loading spec.md…'],
  ['preparation', render(PreparationSkeleton), 'Loading preparation…'],
]

describe.each(SITES)('%s while it loads', (_site, html, label) => {
  it('is a skeleton announced by what it is loading', () => {
    expect(html).toContain('role="status"')
    expect(html).toContain(`<span class="sr-only">${label}</span>`)
    expect(html).not.toContain('animate-spin')
  })

  it('waits 300ms before fading in', () => {
    expect(html).toContain('animate-fade-in [animation-delay:300ms]')
  })
})

describe('the skeletons are shaped like their content', () => {
  it('the sidebar: rows shaped like feature rows', () => {
    const html = render(FeatureRowsSkeleton)
    expect(count(html, 'feature-row')).toBe(4)
    expect(html).toContain('h-(--row-h)')
  })

  it('the first load: the portfolio title over project rows', () => {
    const html = render(ProjectsSkeleton)
    expect(count(html, 'title')).toBe(1)
    expect(count(html, 'project-row')).toBe(3)
  })

  it('the general settings: the Server and Sessions rows', () => {
    expect(count(render(SettingsSkeleton), 'setting-row')).toBe(5)
  })

  it('the details aside: the Knowledge doc rows', () => {
    expect(count(render(DetailsSkeleton), 'doc-row')).toBe(3)
  })

  it('an artifact pane: paragraphs of prose', () => {
    const html = renderToStaticMarkup(createElement(ProseSkeleton, { label: 'Loading spec.md…' }))
    expect(count(html, 'paragraph')).toBe(2)
  })

  it('preparation: the call to action’s title and sentence', () => {
    const html = render(PreparationSkeleton)
    expect(count(html, 'title')).toBe(1)
    expect(count(html, 'sentence')).toBe(1)
  })
})

describe('no content area uses the old loading line', () => {
  const src = join(import.meta.dirname, '../src')
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f))

  it('renders <Loading> nowhere in apps/web/src', () => {
    const offenders = files.filter((f) => readFileSync(join(src, f), 'utf8').includes('<Loading'))
    expect(offenders).toEqual([])
  })
})
