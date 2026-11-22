// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Involvement, ReviewPackage } from '@runcastle/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { FeatureLinksContext, type FeatureLinks } from '../src/components/chat/thread/FeatureCardItems'
import { sharedLevel } from '../src/components/involvement/Involvement'
import {
  EpicInvolvement,
  FeatureInvolvement,
  epicLevels,
  useSetInvolvement,
} from '../src/components/involvement/InvolvementControls'
import { PhoneChatBar } from '../src/components/phone/PhoneChatBar'
import { ReviewPackagePage } from '../src/components/review/ReviewPackagePage'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadItem } from '../src/lib/chat-thread'
import { ToastProvider } from '../src/lib/toast'
import { fakeTrpc } from './fake-trpc'
import { listItem } from './fixtures'
import { openMenu, pickOption } from './floating'

vi.mock('../src/components/Markdown', () => ({ Markdown: ({ source }: { source: string }) => <p>{source}</p> }))

/**
 * "Involve me in" wired up (docs/features/how-involved-am-i decisions 3, 4, 7):
 * the picker on each created row of the features card, the feature header's
 * picker, the phone's sheet, the epic's "Set all to…", and the review
 * package's "Decided without you". Tier 2: the pickers' lists only exist once
 * open, and the saves go through the app's real tRPC hooks over a fake server.
 */

const feature = (id: string, title: string, over: Partial<FeatureListItem> = {}): FeatureListItem => ({
  ...listItem({ id, slug: `${id}-slug`, ...over }),
  title,
  ...over,
})

afterEach(cleanup)

describe('the level the epic’s features share', () => {
  it('is the one level when they all hold it, else null', () => {
    expect(sharedLevel(['resultOnly', 'resultOnly'])).toBe('resultOnly')
    expect(sharedLevel(['everything', 'nothing'])).toBeNull()
    expect(sharedLevel([])).toBeNull()
  })

  it('counts only the epic’s features that have not shipped or been archived', () => {
    const features = [
      feature('f1', 'Checkout page', { chatId: 'epic', involvement: 'everything' }),
      feature('f2', 'Saved cards', { chatId: 'epic', involvement: 'resultOnly' }),
      feature('f3', 'Receipts', { chatId: 'epic', status: 'shipped', involvement: 'nothing' }),
      feature('f4', 'Old idea', { chatId: 'epic', status: 'archived', involvement: 'nothing' }),
      feature('f5', 'Elsewhere', { chatId: 'other', involvement: 'nothing' }),
      feature('f6', 'Coupons', { chatId: 'epic', status: 'draft', involvement: 'designsAndResult' }),
    ]
    expect(epicLevels(features, 'epic')).toEqual(['everything', 'resultOnly', 'designsAndResult'])
  })
})

describe('the features card’s pickers', () => {
  const FEATURES = [
    feature('f1', 'Checkout page', { involvement: 'everything' }),
    feature('f2', 'Saved cards', { involvement: 'designsAndResult' }),
    feature('f3', 'Coupons', { status: 'draft', involvement: 'resultOnly' }),
    feature('f4', 'Receipts', { status: 'shipped', involvement: 'nothing' }),
    feature('f5', 'Refunds', { involvement: 'nothing' }),
  ]
  const CARD: ThreadItem = {
    kind: 'features_card',
    id: 'features_card:1',
    rows: [
      { featureId: 'f1', title: 'Checkout page', actions: ['created', 'started'] },
      { featureId: 'f2', title: 'Saved cards', actions: ['created'] },
      { featureId: 'f3', title: 'Coupons', actions: ['parked'] },
      { featureId: 'f4', title: 'Receipts', actions: ['created'] },
      { featureId: 'f5', title: 'Refunds', actions: ['started'] },
    ],
  }

  function setup(save: FeatureLinks['involvement'] | undefined) {
    const links: FeatureLinks = { features: FEATURES, openFeature: vi.fn(), ...(save ? { involvement: save } : {}) }
    render(
      <FeatureLinksContext.Provider value={links}>
        <ChatThread items={[CARD]} state="idle" footer={null} />
      </FeatureLinksContext.Provider>,
    )
  }
  const pickers = () => screen.queryAllByRole('combobox').map((c) => c.getAttribute('aria-label'))

  it('puts the feature’s own level on each created or parked row that can still change', () => {
    setup({ set: vi.fn(), pendingFor: () => undefined })
    // Receipts shipped and Refunds was only started by this turn: neither takes one.
    expect(pickers()).toEqual([
      'Involve me in: Everything',
      'Involve me in: Designs and result',
      'Involve me in: Result only',
    ])
  })

  it('saves a pick through the shell, naming the feature for its toast', () => {
    const set = vi.fn()
    setup({ set, pendingFor: () => undefined })
    pickOption(screen.getByRole('combobox', { name: 'Involve me in: Designs and result' }), 'Nothing')
    expect(set).toHaveBeenCalledWith('f2', 'nothing', 'Saved cards')
  })

  it('shows the level a save in flight is giving', () => {
    setup({ set: vi.fn(), pendingFor: (id) => (id === 'f1' ? 'resultOnly' : undefined) })
    expect(pickers()[0]).toBe('Involve me in: Result only')
  })

  it('shows no picker where nothing can save one', () => {
    setup(undefined)
    expect(pickers()).toEqual([])
  })
})

function withServer(handlers: Parameters<typeof fakeTrpc>[0]) {
  const server = fakeTrpc(handlers)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <server.Wrapper>
      <ToastProvider>{children}</ToastProvider>
    </server.Wrapper>
  )
  return { server, wrapper }
}

describe('the feature header’s picker', () => {
  function Header({ f }: { f: FeatureListItem }) {
    return <FeatureInvolvement feature={f} save={useSetInvolvement()} />
  }

  it('shows the feature’s level and saves a pick with feature.setInvolvement', async () => {
    const f = feature('f1', 'Saved cards', { involvement: 'designsAndResult' })
    const { server, wrapper } = withServer({
      'feature.setInvolvement': () => ({ ok: true }),
      'feature.list': () => [f],
    })
    render(<Header f={f} />, { wrapper })
    const trigger = screen.getByRole('combobox', { name: 'Involve me in: Designs and result' })
    expect(trigger.textContent).toContain('Designs and result')
    pickOption(trigger, 'Result only')
    await waitFor(() => expect(server.inputs('feature.setInvolvement')).toEqual([{ featureId: 'f1', level: 'resultOnly' }]))
  })

  it('is still on a shipped feature', () => {
    const { wrapper } = withServer({})
    render(<Header f={feature('f1', 'Saved cards', { status: 'shipped', involvement: 'nothing' })} />, { wrapper })
    expect((screen.getByRole('combobox', { name: 'Involve me in: Nothing' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the phone’s “Involve me in”', () => {
  it('is a line of the “…” sheet that opens the four levels', () => {
    const onChange = vi.fn<(level: Involvement) => void>()
    render(<PhoneChatBar title="Saved cards" onBack={() => {}} involvement={{ value: 'everything', onChange }} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: /^Involve me in/ }))
    const sheet = screen.getByRole('dialog', { name: 'Involve me in' })
    const rows = within(sheet).getAllByRole('button').filter((b) => b.hasAttribute('aria-current') || b.textContent?.match(/^(Everything|Designs and result|Result only|Nothing)/))
    expect(rows.map((b) => b.textContent?.match(/^(Everything|Designs and result|Result only|Nothing)/)?.[0])).toEqual([
      'Everything',
      'Designs and result',
      'Result only',
      'Nothing',
    ])
    expect(rows[0]!.getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(sheet).getByRole('button', { name: /^Result only/ }))
    expect(onChange).toHaveBeenCalledWith('resultOnly')
  })

  it('has no “…” for it when the feature gives none', () => {
    render(<PhoneChatBar title="Saved cards" onBack={() => {}} />)
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })
})

describe('“Set all to…” on the epic', () => {
  const epic = (levels: Involvement[]) =>
    levels.map((involvement, i) => feature(`f${i + 1}`, `Feature ${i + 1}`, { chatId: 'chat_epic', involvement }))

  it('says “Mixed” when the features differ, and sets every one with feature.setEpicInvolvement', async () => {
    const { server, wrapper } = withServer({
      'feature.list': () => [...epic(['everything', 'designsAndResult', 'resultOnly']), feature('fx', 'Shipped', { chatId: 'chat_epic', status: 'shipped' })],
      'feature.setEpicInvolvement': () => ({ changed: 3 }),
    })
    render(<EpicInvolvement projectId="proj_1" chatId="chat_epic" />, { wrapper })
    const trigger = await screen.findByRole('button', { name: 'Involve me in for all features: Mixed' })
    expect(trigger.textContent).toContain('Mixed')
    openMenu(trigger)
    expect(screen.getByText('Set all 3 features to…')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /^Nothing/ }))
    await waitFor(() => expect(server.inputs('feature.setEpicInvolvement')).toEqual([{ chatId: 'chat_epic', level: 'nothing' }]))
    expect(await screen.findByText('All 3 features: Involve me in Nothing')).toBeTruthy()
  })

  it('names the level they share', async () => {
    const { wrapper } = withServer({ 'feature.list': () => epic(['resultOnly', 'resultOnly']) })
    render(<EpicInvolvement projectId="proj_1" chatId="chat_epic" />, { wrapper })
    const trigger = await screen.findByRole('button', { name: 'Involve me in for all features: Result only' })
    expect(trigger.textContent).toContain('Result only')
  })

  it('is not there for an epic with no feature left to set', async () => {
    const { server, wrapper } = withServer({ 'feature.list': () => [feature('fx', 'Shipped', { chatId: 'chat_epic', status: 'shipped' })] })
    const { container } = render(<EpicInvolvement projectId="proj_1" chatId="chat_epic" />, { wrapper })
    await waitFor(() => expect(server.inputs('feature.list').length).toBeGreaterThan(0))
    expect(container.textContent).toBe('')
  })
})

describe('the review package’s “Decided without you”', () => {
  const pack = (decidedWithoutYou: ReviewPackage['decidedWithoutYou']): ReviewPackage => ({
    ticketId: 't1',
    featureId: 'f1',
    seq: 3,
    round: 2,
    passKind: 'review',
    verdict: 'Saved cards work.',
    account: '',
    commitsSince: 0,
    hasWalkthrough: false,
    groups: [],
    findings: [],
    empty: 'This review read the code.',
    decidedWithoutYou,
  })

  it('lists each decision by its number in decisions.md', () => {
    render(
      <ReviewPackagePage
        pack={pack([
          { n: 4, title: 'Expired cards stay in the list' },
          { n: 7, title: 'A card is removed with one tap' },
        ])}
        onClose={() => {}}
      />,
    )
    const section = screen.getByRole('region', { name: /Decided without you/ })
    expect(within(section).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '4Expired cards stay in the list',
      '7A card is removed with one tap',
    ])
    expect(section.textContent).toContain('To change one, tell the feature’s lead.')
  })

  it('is not there when nothing was decided without you', () => {
    render(<ReviewPackagePage pack={pack([])} onClose={() => {}} />)
    expect(screen.queryByText('Decided without you')).toBeNull()
  })
})
