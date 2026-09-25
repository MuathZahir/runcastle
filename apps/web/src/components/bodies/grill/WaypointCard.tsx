import { useState } from 'react'
import { trpc } from '../../../trpc'
import { useToast } from '../../../lib/toast'
import type { LiveSessionBlocker, RailWaypoint, WaypointGroupKey } from '../../../lib/feature-ui'
import { IconChevronRight, IconPlay, IconRefresh } from '../../../icons'
import { Button, StatusDot, cx } from '../../../ui'
import type { StatusTone } from '../../../ui'
import { Markdown } from '../../Markdown'

const GROUP_TONE: Record<WaypointGroupKey, StatusTone> = {
  ready: 'accent',
  working: 'live',
  waiting: 'neutral',
  done: 'success',
}

/**
 * One waypoint on the map, as a row: its state dot, its title, its type — and,
 * opened, the question it asks and the one action a ready waypoint offers.
 * A frozen record (`readonly`) shows every row open and acts on nothing.
 */
export function WaypointCard({
  featureId,
  group,
  item,
  blocker,
  readonly = false,
}: {
  featureId: string
  group: WaypointGroupKey
  item: RailWaypoint
  blocker?: LiveSessionBlocker
  readonly?: boolean
}) {
  const waypoint = item.waypoint
  const [open, setOpen] = useState(item.openByDefault)
  const [confirming, setConfirming] = useState(false)
  const utils = trpc.useUtils()
  const toast = useToast()
  const research = waypoint.type === 'research'
  const resuming = !research && !!waypoint.lastSessionId
  const byRun = waypoint.claimedBy?.startsWith('run_') ?? false
  const shownOpen = readonly || open
  const work = trpc.feature.workWaypoint.useMutation({
    onSuccess: () => {
      setConfirming(false)
      void utils.feature.get.invalidate({ id: featureId })
      void utils.feature.list.invalidate()
    },
    onError: (error, variables) => {
      if (!research && !variables.endLive && blocker && error.data?.code === 'PRECONDITION_FAILED') setConfirming(true)
      else {
        setConfirming(false)
        toast.push(error.message)
      }
    },
  })

  const head = (
    <>
      {!readonly && (
        <IconChevronRight
          size={12}
          className={cx(
            'shrink-0 text-icon transition-transform duration-(--dur-2) ease-app',
            shownOpen && 'rotate-90',
          )}
        />
      )}
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <StatusDot tone={GROUP_TONE[group]} />
      </span>
      <span
        className={cx(
          'min-w-0 flex-1 truncate text-sm',
          group === 'done' ? 'text-text-secondary' : 'font-medium text-text',
        )}
      >
        {waypoint.title}
      </span>
      <span className="shrink-0 text-xs text-text-tertiary">{item.stateWord}</span>
    </>
  )

  return (
    <div className="rounded-md">
      {readonly ? (
        <div className="flex min-h-8 items-center gap-2 px-2">{head}</div>
      ) : (
        <button
          type="button"
          className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md bg-transparent px-2 text-left transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover"
          aria-expanded={shownOpen}
          title={shownOpen ? 'Collapse this waypoint' : 'Expand this waypoint'}
          onClick={() => setOpen((value) => !value)}
        >
          {head}
        </button>
      )}
      {shownOpen && (
        <div className={cx('pr-2 pb-3 text-sm animate-fade-in', readonly ? 'pl-8' : 'pl-[3.25rem]')}>
          <Markdown source={waypoint.question} />
          {group === 'working' && byRun && <div className="mt-2 text-xs text-text-tertiary">Researching…</div>}
          {group === 'done' && waypoint.summary && (
            <Markdown source={waypoint.summary} tone="tertiary" className="mt-2" />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
            <span className="font-mono">{waypoint.type}</span>
            {item.originTitle && <span>Surfaced by {item.originTitle}</span>}
          </div>
          {!readonly && group === 'ready' && (
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                icon={resuming ? <IconRefresh /> : <IconPlay />}
                disabled={work.isPending}
                title={
                  research
                    ? 'Start an unattended research run on this waypoint'
                    : resuming
                      ? 'Resume the previous session on this waypoint'
                      : 'Claim this waypoint and open a session'
                }
                onClick={() => work.mutate({ featureId, waypointId: waypoint.id })}
              >
                {resuming ? 'Resume' : 'Work'}
              </Button>
              {research && <span className="text-xs text-text-tertiary">Runs unattended</span>}
            </div>
          )}
          {!readonly && confirming && blocker && (
            <div className="mt-3 rounded-md bg-danger-subtle px-3 py-2" role="alert">
              <div className="text-xs text-text-secondary">
                {blocker.waypointTitle ? (
                  <>
                    A session is live on <b className="font-medium text-text">{blocker.waypointTitle}</b> and its
                    waypoint is still open. End it and work this instead?
                  </>
                ) : (
                  <>A {blocker.kind} session is live on this feature. End it and work this instead?</>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={work.isPending}
                  onClick={() => work.mutate({ featureId, waypointId: waypoint.id, endLive: true })}
                >
                  End &amp; work this
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
