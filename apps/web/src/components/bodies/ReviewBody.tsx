import { useState } from 'react'
import { Button, CheckLine, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { FeatureFull, SettingsView } from '../../lib/api'
import type { DriveState } from '../../lib/workspace'
import { driveCapabilities } from '../../lib/settings'
import { testDriveExplainer } from '../../lib/vocabulary'
import {
  latestRun,
  mergeConflictKickoff,
  openApp,
  openAppWaitingLabel,
  reviewChecks,
  sessionActive,
  type MergeConflictState,
} from '../../lib/feature-ui'
import { fmtDateTime, relTime } from '../../lib/format'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { ErrorBoundary } from '../ErrorBoundary'
import { SessionPanel } from '../SessionPanel'
import { TerminalView } from '../TerminalView'

/**
 * The review phase body (app-redesign): a summary of the finished run on the
 * left (ticket tally, run outcome, commit count, branch) and the test-drive
 * panel on the right. All figures come from real wire data — the start/stop and
 * merge actions live in the workspace next-step bar. While a drive is active the
 * embedded dev pane + "Open app" link render full-width below the cards.
 *
 * Below those, the {@link NotesPanel} — capture box plus checklist — for the
 * whole review phase, drive or no drive.
 *
 * An Iterate (`revisit`) session launched from the review bar renders as an
 * inline terminal above the cards — same pattern as GrillBody/TicketsBody — so
 * the human can drive the fix-ticket interview without leaving review.
 *
 * A conflicted Merge & ship surfaces the {@link ConflictCard} above the cards:
 * it lists the conflicting files and offers "Resolve with agent", which opens a
 * revisit session pre-briefed to merge the base branch into the feature branch
 * in the talk worktree. The conflict is read from the event feed (so it survives
 * a reload) by the workspace and handed down here, because the next-step bar
 * reads the same one: the bar recommending a merge over the top of this panel
 * telling the user to resolve first is findings F8, and one derivation for both
 * is what makes that contradiction unrepresentable. The action is hidden while
 * any session is live (one terminal per feature — the server refuses a second
 * one anyway).
 */
export function ReviewBody({
  full,
  driving,
  conflict,
  readonly = false,
}: {
  full: FeatureFull
  driving: DriveState | null
  conflict: MergeConflictState | null
  /** Looking back at review on a shipped feature — history, not work. */
  readonly?: boolean
}) {
  const { feature, tickets, runs } = full
  // Live-only: the conflict card's "Resolve with agent" spawns a terminal, and
  // one terminal per feature — an ENDED session (which the panel still renders,
  // with its Resume) must not hide it.
  const sessionLive = full.sessions.some(sessionActive)
  const run = latestRun(runs)
  const isDriving = driving?.featureId === feature.id
  // Commits come from git, not from ticket commit rows (findings F23). Polled
  // slower than the 1.5s shell: a `rev-list --count` is cheap but this figure
  // only moves when a burn lands, and a human reads a card, not a ticker.
  const commits = trpc.feature.commitCount.useQuery(
    { featureId: feature.id },
    { refetchInterval: useLivePoll(5000) },
  )
  const drive = trpc.feature.driveInfo.useQuery(undefined, { refetchInterval: useLivePoll() })
  // The drive slot is shared with preparation's dry run, which belongs to no
  // feature (decision 9). Everything below reads this feature's own drive or
  // nothing: a dry run's pane and dev server described under this branch would
  // be a straight misattribution.
  const ownDrive = drive.data?.featureId === feature.id ? drive.data : undefined
  const dryRun = drive.data?.dryRun ?? false
  const checks = reviewChecks({ tickets, run, commitCount: commits.data?.count })
  // What a drive on THIS project does — a prepared one renders an environment,
  // runs the setup command and boots a dev server; an unprepared one checks the
  // branch out and stops. The card used to promise the first to everyone.
  // (`useQuery().data` infers to `{}` here — the same tRPC-in-component typing
  // gap the settings overlay documents; the runtime value is a SettingsView.)
  const settings = trpc.settings.get.useQuery({ projectId: feature.projectId })
  const caps = driveCapabilities(settings.data as SettingsView | undefined)

  return (
    <div className="review-body">
      {/* A retrospective view of review on a shipped feature must not offer to
          reopen its conversation (findings F10.6). */}
      <SessionPanel
        featureId={feature.id}
        sessions={full.sessions}
        className="review-session"
        showResume={!readonly}
      />

      {conflict && (
        <ConflictCard
          featureId={feature.id}
          branch={feature.branch}
          conflict={conflict}
          sessionLive={sessionLive}
        />
      )}

      <div className="review-grid">
      <div className="review-card">
        <SectionTitle>Summary</SectionTitle>
        {checks.map((row) => (
          <CheckLine key={row.key} row={row} />
        ))}
        <div className="review-foot">
          {feature.branch}
          {commits.data ? ` → ${commits.data.base}` : ''}
        </div>
      </div>

      <div className="review-card">
        <SectionTitle>Test drive</SectionTitle>
        {isDriving && driving ? (
          <DriveStatus branch={driving.branch} drive={ownDrive} />
        ) : dryRun ? (
          <div className="drive-copy">
            A preparation dry-run is holding the drive — it is proving this project’s drive
            commands on your machine. Stop it from Preparation, and this branch can take the wheel.
          </div>
        ) : (
          <div className="drive-copy">
            {testDriveExplainer(caps)} Start it from the next step — the merge gate wants a human
            behind the wheel.
          </div>
        )}
      </div>
      </div>

      {isDriving && ownDrive && <DrivePane drive={ownDrive} />}

      <NotesPanel featureId={feature.id} tickets={tickets} readonly={readonly} />
    </div>
  )
}

/**
 * Test-drive notes: what the human saw while clicking through the branch, and
 * what became of it. Capture + checklist + one-click promotion (decisions #2).
 *
 * Deliberately NOT gated on an active drive (decisions #4). Observations do not
 * stop when the dev server does — the "one more thing" typed right after Stop,
 * or something spotted in the diff, would be lost if the box only existed while
 * a drive was live, and there is no integrity reason to require a running server
 * to record an observation.
 *
 * A note is `open` until it is ticked (`done` — handled or dismissed, toggleable
 * both ways) or promoted. Promoted is frozen with a link to its ticket: it is
 * the record of what that ticket was built from, so it offers no affordances at
 * all. The server refuses every one of those transitions anyway; this only
 * avoids showing a button that would be turned down.
 */
function NotesPanel({
  featureId,
  tickets,
  readonly,
}: {
  featureId: string
  tickets: FeatureFull['tickets']
  /** Looking back at review on a shipped feature — the checklist, no editing. */
  readonly: boolean
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const notes = trpc.notes.list.useQuery({ featureId }, { refetchInterval: useLivePoll() })
  const [draft, setDraft] = useState('')
  // The note being edited in place, or null. One at a time — same as the ticket
  // ledger's editor.
  const [editing, setEditing] = useState<string | null>(null)

  const refresh = (): void => void utils.notes.list.invalidate({ featureId })
  const onError = (e: { message: string }): void => toast.push(e.message)

  const add = trpc.notes.add.useMutation({
    onSuccess: () => {
      setDraft('')
      refresh()
    },
    onError,
  })
  const edit = trpc.notes.edit.useMutation({
    onSuccess: () => {
      setEditing(null)
      refresh()
    },
    onError,
  })
  const remove = trpc.notes.remove.useMutation({ onSuccess: refresh, onError })
  const toggle = trpc.notes.toggle.useMutation({ onSuccess: refresh, onError })
  const promote = trpc.notes.promote.useMutation({
    onSuccess: ({ ticket }) => {
      refresh()
      // The ticket is new: without this the ledger and the next-step bar would
      // keep the pre-promotion list until their own poll came round, and the
      // one-click promise is that the ticket is simply there.
      void utils.feature.get.invalidate({ id: featureId })
      toast.push(`promoted to ticket #${ticket.seq}`, 'success')
    },
    onError,
  })

  const rows = notes.data ?? []
  // One mutation in flight at a time: the list is about to be refetched, so a
  // second click would act on a row the server is already moving.
  const busy = edit.isPending || remove.isPending || toggle.isPending || promote.isPending
  const submit = (): void => {
    if (draft.trim() && !add.isPending) add.mutate({ featureId, text: draft })
  }

  return (
    <div className="review-card notes-card">
      <SectionTitle>Test-drive notes</SectionTitle>

      {!readonly && (
        <div className="notes-form">
          <input
            className="notes-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="What did you just see? e.g. the run chip goes grey while burning"
          />
          <Button variant="ghost" onClick={submit} disabled={!draft.trim() || add.isPending}>
            Add
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="drive-copy">
          Nothing noted yet. Anything you write here lands in the feature’s
          <code> test-notes.md</code>, which the next lap’s session reads — or becomes a ticket in
          one click.
        </div>
      ) : (
        <div className="notes-list">
          {rows.map((note) => {
            const ticket = note.ticketId ? tickets.find((t) => t.id === note.ticketId) : undefined
            const open = note.status === 'open'

            if (editing === note.id) {
              return (
                <NoteEditor
                  key={note.id}
                  text={note.text}
                  busy={edit.isPending}
                  onCancel={() => setEditing(null)}
                  onSave={(text) => edit.mutate({ noteId: note.id, text })}
                />
              )
            }

            return (
              <div key={note.id} className={`note-row is-${note.status}`}>
                {note.status === 'promoted' ? (
                  <span className="note-frozen" title="promoted — frozen as its ticket's record">
                    →
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    className="note-check"
                    checked={note.status === 'done'}
                    disabled={readonly || busy}
                    aria-label={open ? 'mark handled' : 'reopen'}
                    onChange={() => toggle.mutate({ noteId: note.id })}
                  />
                )}

                <span className="note-text">{note.text}</span>

                {ticket && <span className="note-ticket">#{ticket.seq} {ticket.title}</span>}

                {!readonly && open && (
                  <span className="note-actions">
                    <button className="btn btn-xs btn-ghost" onClick={() => setEditing(note.id)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-xs btn-ghost"
                      disabled={busy}
                      onClick={() => remove.mutate({ noteId: note.id })}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn-xs btn-ghost"
                      disabled={busy}
                      title="Make this a pending ticket on the current lap"
                      onClick={() => promote.mutate({ noteId: note.id })}
                    >
                      → ticket
                    </button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** One note's text, in place. Only open notes reach here. */
function NoteEditor({
  text,
  busy,
  onCancel,
  onSave,
}: {
  text: string
  busy: boolean
  onCancel: () => void
  onSave: (text: string) => void
}) {
  const [value, setValue] = useState(text)
  const save = (): void => {
    if (value.trim() && !busy) onSave(value)
  }

  return (
    <div className="note-row is-editing">
      <input
        className="notes-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') onCancel()
        }}
        autoFocus
      />
      <span className="note-actions">
        <button className="btn btn-xs btn-ghost" disabled={!value.trim() || busy} onClick={save}>
          Save
        </button>
        <button className="btn btn-xs btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  )
}

/**
 * What an active test drive actually is, said out loud (findings F22). A drive is
 * a `git checkout` plus — only if the project has a dev command — a dev server.
 * With no command configured the UI used to flip to "driving now" with a pulsing
 * dev-server chip over a checkout and nothing else, leaving the user waiting for
 * a URL that was never coming.
 *
 * Three states, because the three have different fixes: a server is up (drive
 * away), nothing was meant to start (set a dev command in Settings), or the spawn
 * failed (its output is in the timeline).
 */
function DriveStatus({
  branch,
  drive,
}: {
  branch: string
  drive: { devPaneId?: string; devConfigured: boolean } | null | undefined
}) {
  // While driveInfo is still in flight, say the one thing that is certainly true.
  if (!drive) {
    return (
      <div className="drive-live">
        <span className="drive-label">branch checked out</span>
        <span className="drive-loc">{branch}</span>
      </div>
    )
  }
  if (drive.devPaneId) {
    return (
      <>
        <div className="drive-live">
          <span className="drive-pulse" />
          <span className="drive-label">driving now</span>
          <span className="drive-loc">{branch}</span>
        </div>
        <div className="drive-copy">
          Click through the feature. When it feels right, merge — or stop the drive and send
          feedback back through tickets.
        </div>
      </>
    )
  }
  return (
    <>
      <div className="drive-live">
        <span className="drive-label is-quiet">checked out — nothing started</span>
        <span className="drive-loc">{branch}</span>
      </div>
      <div className="drive-copy">
        {drive.devConfigured
          ? 'Your repo is on this branch, but the dev server did not start — its output is in the timeline. Click through whatever you run yourself, then merge.'
          : 'Your repo is on this branch, but no server was started: this project has no dev command. Set one in Settings and the next drive boots the app here — or run it yourself and click through.'}
      </div>
    </>
  )
}

/**
 * The merge-conflict card (CONTEXT decision #9). Appears after a conflicted
 * Merge & ship, listing the conflicting files. "Resolve with agent" opens a
 * revisit session whose first message briefs the merge-into-feature resolution
 * (base branch + file list), so the agent resolves in the talk worktree and the
 * human retries Merge & ship. Hidden while a session is live — one terminal per
 * feature (the launcher's `assertSpawnable` refuses a second one regardless).
 */
function ConflictCard({
  featureId,
  branch,
  conflict,
  sessionLive,
}: {
  featureId: string
  branch: string
  conflict: MergeConflictState
  sessionLive: boolean
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const launch = trpc.feature.launchSession.useMutation({
    onSuccess: () => void utils.feature.get.invalidate({ id: featureId }),
    onError: (e) => toast.push(e.message),
  })

  return (
    <div className="review-card conflict-card">
      <div className="conflict-head">
        <SectionTitle>Merge conflict</SectionTitle>
        {/* When, because a red panel with no date reads as "right now" — the
            audit found one that was fifteen days stale (findings F8). */}
        <span className="conflict-when" title={fmtDateTime(conflict.at)}>
          recorded {relTime(conflict.at)} ago
        </span>
      </div>
      <div className="drive-copy">
        Merging <code>{conflict.base}</code> into <code>{branch}</code> hit conflicts. An agent can
        merge the base into this branch in the talk worktree, resolve with full spec context, and
        commit — then retry Merge &amp; ship.
      </div>
      {conflict.files.length > 0 && (
        <ul className="conflict-files">
          {conflict.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {!sessionLive && (
        <Button
          variant="solid"
          className="conflict-resolve"
          disabled={launch.isPending}
          onClick={() =>
            launch.mutate({
              featureId,
              kind: 'revisit',
              kickoffLine: mergeConflictKickoff(conflict.base, branch, conflict.files),
              // The purpose is what lets the session actually do what the kickoff
              // asks: the edit guard exempts its writes while the merge below is
              // in progress in the talk worktree.
              purpose: 'resolve-conflict',
              purposeData: { mergeFrom: conflict.base, mergeInto: branch },
            })
          }
        >
          Resolve with agent
        </Button>
      )}
    </div>
  )
}

/**
 * The test-drive dev pane: the project dev command runs in a drive-owned PTY the
 * server streams over `/ws/terminal/:devPaneId`. Collapsed to a status strip by
 * default (the terminal is only mounted — and only connects its WS — once
 * expanded), so boot output/errors are one click away. The sniffed URL surfaces
 * as plain "starting…" text and only becomes the "Open app" link once the server
 * has polled it and something answered; both the pane and the link disappear
 * when the drive stops (driveInfo → null). Nothing auto-opens — the human clicks
 * the link.
 *
 * Rendered only when a dev pane really exists — a "dev server" chip over a
 * process that was never spawned is the lie findings F22 is about, and the
 * {@link DriveStatus} card says what happened instead.
 */
function DrivePane({
  drive,
}: {
  drive: {
    branch: string
    devPaneId?: string
    devUrl?: string
    devReady?: boolean
    devReadyTimedOut?: boolean
  }
}) {
  const [expanded, setExpanded] = useState(false)
  const open = openApp(drive)
  if (!drive.devPaneId) return null

  return (
    <div className="drive-pane">
      <div className="drive-pane-strip">
        <span className="drive-pane-kind">dev server</span>
        <span className="drive-pane-loc">{drive.branch}</span>
        <span className="drive-pane-spacer" />
        {open?.state === 'ready' ? (
          <a className="drive-open" href={open.url} target="_blank" rel="noreferrer noopener">
            Open app ↗
          </a>
        ) : (
          open && <span className="drive-open drive-open-waiting">{openAppWaitingLabel(open)}</span>
        )}
        <button
          type="button"
          className="btn btn-xs btn-ghost drive-pane-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide output' : 'Show output'}
        </button>
      </div>

      {expanded && (
        <div className="drive-pane-term">
          <ErrorBoundary label="dev terminal">
            <TerminalView sessionId={drive.devPaneId} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
