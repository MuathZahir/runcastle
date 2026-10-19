import { useState } from 'react'
import type { UiStatesModel, UiStatesStory } from '../../lib/api'
import { trpc } from '../../trpc'
import { IconExpand } from '../../icons'
import { Button, Dialog, DialogHeader, Disclosure, StatusDot, Tag, cx } from '../../ui'

/**
 * "UI states" (features-show-their-ui-states-as-stories, decision 12): the
 * stories this feature changed or added, each rendered live in a frame from the
 * stories port. A changed story shows beside its version at the branch point
 * (decision 6), a new one alone, and the far matches — stories that reach a
 * changed file only through other files — on one collapsed line (decision 7).
 *
 * The frames are the user's own components, cross-origin by design (decision
 * 13), so they cannot be auto-sized: a fixed height, and "Open larger" for the
 * one story full-size. The copy says "UI states" and "stories", never the tool
 * that builds them (decision 11).
 */
export function UiStatesSection({
  model,
  betweenReviews = false,
  className,
}: {
  model: UiStatesModel | null
  /** Shown outside review, where the build is the last review pass's, not this one's. */
  betweenReviews?: boolean
  /** Placement only (STYLE.md's className rule). */
  className?: string
}) {
  const [larger, setLarger] = useState<{ story: UiStatesStory; url: string } | null>(null)
  if (!model) return null
  const storyCount = model.changed.length + model.new.length + model.affected.length
  if (model.status === 'built' && storyCount === 0) return null

  const open = (story: UiStatesStory, url: string) => setLarger({ story, url })
  const commit = model.commit.slice(0, 7)
  const builtAt = betweenReviews ? 'Built at the last review' : 'Built at review'

  return (
    <section id="ui-states" className={cx('@container flex flex-col gap-4', className)}>
      <div className="flex min-h-7 items-baseline gap-3">
        <h2 className="m-0 text-lg font-semibold text-text">UI states</h2>
        <span className="text-xs text-text-tertiary">
          {builtAt} · commit <span className="font-mono">{commit}</span>
        </span>
      </div>

      {model.status === 'failed' && (
        <BuildFailure
          headline="The UI states didn’t build"
          note="Review treats this as a failed gate, so it comes back as a fix ticket."
          log={model.log}
        />
      )}
      {model.status === 'couldnt_run' && (
        <BuildFailure
          headline="The UI states couldn’t be built"
          note={model.reason ?? 'No reason was recorded.'}
          log={model.log}
        />
      )}

      {model.status === 'built' && (
        <>
          {model.base === 'failed' && model.changed.length > 0 && (
            <p className="m-0 text-xs text-text-tertiary">
              The before versions didn’t build, so changed stories show this feature’s version only.
            </p>
          )}
          {model.changed.map((story) => (
            <StoryBlock key={story.id} story={story} mark="Changed" onOpen={open} />
          ))}
          {model.new.map((story) => (
            <StoryBlock key={story.id} story={story} mark="New" onOpen={open} />
          ))}
          {model.affected.length > 0 && (
            <Disclosure
              size="sm"
              title={`${model.affected.length} more ${model.affected.length === 1 ? 'story uses' : 'stories use'} changed code`}
            >
              <ul className="m-0 flex list-none flex-col p-0">
                {model.affected.map((story) => (
                  <li key={story.id} className="flex min-h-8 items-center gap-2 text-sm text-text-secondary">
                    <span className="min-w-0 truncate">
                      {storyTitle(story)} · {story.name}
                    </span>
                    <OpenLarger
                      className="ml-auto"
                      onClick={() => open(story, story.frameUrl)}
                    />
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}

      <Dialog
        open={larger !== null}
        onClose={() => setLarger(null)}
        size="full"
        labelledBy="ui-states-larger-title"
        className="flex h-[86vh] flex-col overflow-hidden"
      >
        {larger && (
          <>
            <DialogHeader
              id="ui-states-larger-title"
              title={`${storyTitle(larger.story)} · ${larger.story.name}`}
              onClose={() => setLarger(null)}
            />
            <iframe
              title={`${storyTitle(larger.story)} · ${larger.story.name}, full size`}
              src={larger.url}
              className="block min-h-0 w-full flex-1 border-0 bg-surface-inset"
            />
          </>
        )}
      </Dialog>
    </section>
  )
}

/**
 * The section on the planning and building bodies (decision 12): the last
 * review pass's build stays the feature's evidence until the next review
 * replaces it. Before the first review there is no build, so nothing shows —
 * the build itself is the condition, never a lap or round counter.
 */
export function LastReviewUiStates({ featureId, className }: { featureId: string; className?: string }) {
  const uiStates = trpc.feature.uiStates.useQuery({ featureId })
  return <UiStatesSection model={uiStates.data ?? null} betweenReviews className={className} />
}

/** A story's title as the reader says it: `Checkout/Coupon field` → `Checkout / Coupon field`. */
function storyTitle(story: UiStatesStory): string {
  return story.title.split('/').map((part) => part.trim()).join(' / ')
}

function StoryBlock({
  story,
  mark,
  onOpen,
}: {
  story: UiStatesStory
  mark: 'Changed' | 'New'
  onOpen: (story: UiStatesStory, url: string) => void
}) {
  return (
    <article className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-text">{storyTitle(story)}</span>
        <span className="shrink-0 font-mono text-xs text-text-secondary">{story.name}</span>
        <Tag>{mark}</Tag>
      </div>
      <div className={story.baseFrameUrl ? 'grid grid-cols-1 gap-3 @2xl:grid-cols-2' : 'grid grid-cols-1'}>
        {story.baseFrameUrl && (
          <StoryFrame
            label="Before"
            story={story}
            url={story.baseFrameUrl}
            onOpen={onOpen}
          />
        )}
        <StoryFrame label="This feature" story={story} url={story.frameUrl} onOpen={onOpen} />
      </div>
    </article>
  )
}

function StoryFrame({
  label,
  story,
  url,
  onOpen,
}: {
  label: 'Before' | 'This feature'
  story: UiStatesStory
  url: string
  onOpen: (story: UiStatesStory, url: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-6 items-center gap-2">
        <span className="text-xs text-text-tertiary">{label}</span>
        <OpenLarger className="ml-auto" onClick={() => onOpen(story, url)} />
      </div>
      <iframe
        title={`${storyTitle(story)} · ${story.name}, ${label === 'Before' ? 'before' : 'this feature'}`}
        src={url}
        loading="lazy"
        className="block h-60 w-full rounded-md border border-border-subtle bg-surface-inset"
      />
    </div>
  )
}

function OpenLarger({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" icon={<IconExpand />} className={className} onClick={onClick}>
      Open larger
    </Button>
  )
}

function BuildFailure({ headline, note, log }: { headline: string; note: string; log: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <StatusDot tone="danger" />
        <span className="text-sm font-medium text-text">{headline}</span>
      </div>
      <p className="m-0 text-xs text-text-tertiary">{note}</p>
      {log && (
        <pre className="m-0 max-h-[260px] overflow-auto rounded-md bg-surface-inset px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary">
          {log}
        </pre>
      )}
    </div>
  )
}
