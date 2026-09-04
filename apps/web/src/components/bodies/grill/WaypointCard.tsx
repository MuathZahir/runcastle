import { useState } from 'react'
import { trpc } from '../../../trpc'
import { useToast } from '../../../lib/toast'
import type { LiveSessionBlocker, RailWaypoint, WaypointGroupKey } from '../../../lib/feature-ui'
import { Markdown } from '../../Markdown'

export function WaypointCard({ featureId, group, item, blocker }: { featureId: string; group: WaypointGroupKey; item: RailWaypoint; blocker?: LiveSessionBlocker }) {
  const waypoint = item.waypoint
  const [open, setOpen] = useState(item.expanded)
  const [confirming, setConfirming] = useState(false)
  const utils = trpc.useUtils()
  const toast = useToast()
  const research = waypoint.type === 'research'
  const resuming = !research && !!waypoint.lastSessionId
  const byRun = waypoint.claimedBy?.startsWith('run_') ?? false
  const work = trpc.feature.workWaypoint.useMutation({
    onSuccess: () => { setConfirming(false); void utils.feature.get.invalidate({ id: featureId }); void utils.feature.list.invalidate() },
    onError: (error, variables) => {
      if (!research && !variables.endLive && blocker && error.data?.code === 'PRECONDITION_FAILED') setConfirming(true)
      else { setConfirming(false); toast.push(error.message) }
    },
  })
  return (
    <div className={`wp wp-${group}${group === 'done' ? ` wp-${waypoint.status}` : ''}${open ? ' is-open' : ''}`} role="button" tabIndex={0} aria-expanded={open} title={open ? 'collapse this waypoint' : 'expand this waypoint'} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setOpen(!open) } }}>
      <div className="wp-top">{group === 'claimed' && <span className="wp-pulse" aria-hidden="true" />}<span className="wp-type">{group === 'done' ? waypoint.status : waypoint.type}</span><span className="wp-title">{waypoint.title}</span><span className="wp-caret" aria-hidden="true">▸</span></div>
      {open && <div className="wp-detail" onClick={(event) => event.stopPropagation()}>
        <Markdown source={waypoint.question} className="wp-q" />
        {group === 'blocked' && item.blockerTitles.length > 0 && <div className="wp-blockers">blocked by {item.blockerTitles.join(', ')}</div>}
        {group === 'claimed' && byRun && <div className="wp-run-note">researching…</div>}
        {group === 'done' && waypoint.summary && <Markdown source={waypoint.summary} className="wp-summary" />}
        {item.originTitle && <div className="wp-lineage">surfaced by {item.originTitle}</div>}
      </div>}
      {group === 'frontier' && <div className="wp-actions"><button type="button" className="btn btn-xs btn-solid" disabled={work.isPending} title={research ? 'start an AFK research run on this waypoint' : resuming ? 'resume the previous session on this waypoint' : 'claim this waypoint and open a session'} onClick={(event) => { event.stopPropagation(); work.mutate({ featureId, waypointId: waypoint.id }) }}>{resuming ? 'Resume' : 'Work'}</button>{research && <span className="wp-run-note">runs AFK</span>}</div>}
      {confirming && blocker && <div className="wp-confirm" role="alert"><div className="wp-confirm-text">{blocker.waypointTitle ? <>A session is live on <b>{blocker.waypointTitle}</b> and its waypoint is still open. End it and work this instead?</> : <>A {blocker.kind} session is live on this feature. End it and work this instead?</>}</div><div className="wp-confirm-actions"><button type="button" className="btn btn-xs btn-danger" disabled={work.isPending} onClick={(event) => { event.stopPropagation(); work.mutate({ featureId, waypointId: waypoint.id, endLive: true }) }}>End &amp; work this</button><button type="button" className="btn btn-xs btn-ghost" onClick={(event) => { event.stopPropagation(); setConfirming(false) }}>Cancel</button></div></div>}
    </div>
  )
}
