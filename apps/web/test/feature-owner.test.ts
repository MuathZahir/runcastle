import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OwnerControl } from '../src/components/workspace/OwnerControl'
import { OwnerStrip } from '../src/components/chat/OwnerStrip'
import { TooltipProvider } from '../src/ui/tooltip'
import { UNNAMED_CHAT, ownerReading, type OwnedFeature } from '../src/lib/feature-owner'

/**
 * Every feature has one owner: what the feature header's owner control reads
 * for each owner, read off the feature's holder, its chat and its finish
 * (decisions 11, 12, 14, 21), and the strip above the lead's composer (23, 28).
 */

const threads = [
  { id: 'chat-1', title: 'Notes triage' },
  { id: 'chat-2', title: 'Runcastle orchestrator feature workflow confusion' },
]

const feature = (f: Partial<OwnedFeature>): OwnedFeature => ({ status: 'active', chatId: null, finish: 'you', ...f })

/** The header's words for a feature, as the control renders them (markup stripped). */
function reads(f: OwnedFeature, title = 'Export notes as PDF'): string {
  const r = ownerReading(f, threads)
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(OwnerControl, {
        owner: r.owner,
        ...(r.chatName ? { chatName: r.chatName } : {}),
        planning: r.planning,
        feature: title,
        onChoose: () => {},
      }),
    ),
  )
  return html.replace(/<[^>]*>/g, '')
}

function control(f: OwnedFeature): string {
  const r = ownerReading(f, threads)
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(OwnerControl, {
        owner: r.owner,
        ...(r.chatName ? { chatName: r.chatName } : {}),
        planning: r.planning,
        feature: 'Export notes as PDF',
        onChoose: () => {},
      }),
    ),
  )
}

describe('the owner reading', () => {
  it('reads "Yours" for a feature the human owns', () => {
    expect(reads(feature({ chatId: 'chat-1' }))).toBe('Yours')
  })

  it('reads "<Chat> · you merge" when its chat owns it and shows the human before merging', () => {
    expect(reads(feature({ heldBy: 'chat-1', chatId: 'chat-1', finish: 'show' }))).toBe('Notes triage · you merge')
  })

  it('reads "<Chat> · merges it" when its chat merges it', () => {
    expect(reads(feature({ heldBy: 'chat-2', chatId: 'chat-2', finish: 'merge' }))).toBe(
      'Runcastle orchestrator feature workflow confusion · merges it',
    )
  })

  it('truncates the chat name, never the words after it', () => {
    const html = control(feature({ heldBy: 'chat-2', chatId: 'chat-2', finish: 'merge' }))
    expect(html).toMatch(/class="min-w-0 truncate">Runcastle orchestrator feature workflow confusion</)
    expect(html).toMatch(/class="shrink-0 whitespace-pre"> · merges it</)
  })

  it('reads "Yours to plan · then <Chat>" while the human grills a feature its chat takes at the plan yes', () => {
    const f = feature({ chatId: 'chat-1', finish: 'show' })
    expect(ownerReading(f, threads)).toMatchObject({ planning: true, owner: { kind: 'chat', finish: 'show' } })
    expect(reads(f)).toBe('Yours to plan · then Notes triage')
  })

  it('reads "Yours" with no chat, and the control is not a menu button', () => {
    const f = feature({})
    expect(reads(f)).toBe('Yours')
    const html = control(f)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('aria-haspopup')
    expect(html).toContain('tabindex="0"')
    expect(ownerReading(f, threads).chatName).toBeUndefined()
  })

  it('names a chat the thread list does not know yet plainly, and still opens', () => {
    const f = feature({ heldBy: 'gone', chatId: 'gone', finish: 'show' })
    expect(reads(f)).toBe(`${UNNAMED_CHAT} · you merge`)
    expect(control(f)).toContain('aria-haspopup="menu"')
  })

  it('names the holder only while the feature has not shipped', () => {
    expect(ownerReading(feature({ heldBy: 'chat-1', chatId: 'chat-1', finish: 'show' }), threads).holderId).toBe('chat-1')
    const shipped = ownerReading(feature({ status: 'shipped', heldBy: 'chat-1', chatId: 'chat-1', finish: 'show' }), threads)
    expect(shipped.holderId).toBeUndefined()
    expect(shipped.owner).toEqual({ kind: 'you' })
  })

  it('has no holder for a human-owned feature, so no strip shows over its composer', () => {
    expect(ownerReading(feature({ chatId: 'chat-1' }), threads).holderId).toBeUndefined()
    expect(ownerReading(feature({ chatId: 'chat-1', finish: 'merge' }), threads).holderId).toBeUndefined()
  })
})

describe('OwnerStrip', () => {
  it('says the chat runs the feature and that sending takes it, with the link to the chat', () => {
    const text = renderToStaticMarkup(createElement(OwnerStrip, { chat: 'Notes triage', onOpenChat: () => {} })).replace(
      /<[^>]*>/g,
      '',
    )
    expect(text).toBe('Notes triage runs this feature. Sending makes it yours.Open Notes triage')
  })
})
