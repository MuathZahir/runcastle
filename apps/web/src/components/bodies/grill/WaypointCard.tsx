import { useState } from 'react'
import { trpc } from '../../../trpc'
import { useToast } from '../../../lib/toast'
import type { LiveSessionBlocker, RailWaypoint, WaypointGroupKey } from '../../../lib/feature-ui'
import { Markdown } from '../../Markdown'

export function WaypointCard({ featureId, group, item, blocker, readonly = false }: { featureId: string; group: WaypointGroupKey; item: RailWaypoint; blocker?: LiveSessionBlocker; readonly?: boolean }) {
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
    onSuccess: () => { setConfirming(false); void utils.feature.get.invalidate({ id: featureId }); void utils.feature.list.invalidate() },
    onError: (error, variables) => {
      if (!research && !variables.endLive && blocker && error.data?.code === 'PRECONDITION_FAILED') setConfirming(true)
      else { setConfirming(false); toast.push(error.message) }
    },
  })
  const toggle = () => { if (!readonly) setOpen((value) => !value) }
  return (
    <div className={`rounded-md border p-2 ${group === 'ready' ? 'border-accent-line' : group === 'working' ? 'border-ok/40' : 'border-hairline'} ${group === 'done' ? 'opacity-70' : ''}`} role={readonly ? undefined : 'button'} tabIndex={readonly ? undefined : 0} aria-expanded={readonly ? undefined : shownOpen} title={readonly ? undefined : shownOpen ? 'collapse this waypoint' : 'expand this waypoint'} onClick={toggle} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle() } }}>
      <div className="flex items-center gap-1.5"><span className={`flex items-center gap-1.5 text-[11px] font-semibold ${group === 'ready' ? 'text-accent-hi' : group === 'working' ? 'text-ok' : 'text-text-3'}`}><span className={`size-1.5 rounded-full bg-current ${group === 'working' ? 'animate-pulse' : ''}`} aria-hidden="true" />{item.stateWord}</span><span className="ml-auto font-mono text-[11px] text-text-4">{waypoint.type}</span></div>
      <div className={`mt-1 text-sm ${group === 'done' ? 'font-normal text-text-2' : 'font-medium text-text'}`}>{waypoint.title}</div>
      {shownOpen && <div className="mt-2 text-sm text-text-3" onClick={(event) => event.stopPropagation()}><Markdown source={waypoint.question} />{group === 'working' && byRun && <div className="mt-2 font-mono text-xs text-text-3">researching…</div>}{group === 'done' && waypoint.summary && <Markdown source={waypoint.summary} className="mt-2 text-text-3" />}{item.originTitle && <div className="mt-2 font-mono text-xs text-text-4">surfaced by {item.originTitle}</div>}</div>}
      {!readonly && group === 'ready' && <div className="mt-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}><button type="button" className="btn btn-xs btn-ghost" disabled={work.isPending} title={research ? 'start an unattended research run on this waypoint' : resuming ? 'resume the previous session on this waypoint' : 'claim this waypoint and open a session'} onClick={() => work.mutate({ featureId, waypointId: waypoint.id })}>{resuming ? 'Resume' : 'Work'}</button>{research && <span className="font-mono text-xs text-text-4">runs unattended</span>}</div>}
      {!readonly && confirming && blocker && <div className="mt-2 rounded-md border border-danger/30 bg-danger/5 p-2" role="alert" onClick={(event) => event.stopPropagation()}><div className="text-xs text-text-2">{blocker.waypointTitle ? <>A session is live on <b className="font-semibold text-text">{blocker.waypointTitle}</b> and its waypoint is still open. End it and work this instead?</> : <>A {blocker.kind} session is live on this feature. End it and work this instead?</>}</div><div className="mt-2 flex gap-2"><button type="button" className="btn btn-xs btn-danger" disabled={work.isPending} onClick={() => work.mutate({ featureId, waypointId: waypoint.id, endLive: true })}>End &amp; work this</button><button type="button" className="btn btn-xs btn-ghost" onClick={() => setConfirming(false)}>Cancel</button></div></div>}
    </div>
  )
}
