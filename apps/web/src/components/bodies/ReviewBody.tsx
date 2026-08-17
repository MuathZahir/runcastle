import { useState } from 'react'
import type { TestNote } from '@runcastle/core'
import { Button, CheckLine, LapSections, NoteAuthorChip, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { FeatureFull, SettingsView } from '../../lib/api'
import type { DriveState } from '../../lib/workspace'
import { driveCapabilities } from '../../lib/settings'
import { testDriveExplainer } from '../../lib/vocabulary'
import {
  driveFailure,
  driveWheel,
  groupByLap,
  latestRun,
  mergeConflictKickoff,
  openApp,
  openAppWaitingLabel,
  reviewChecks,
  reviewWalkthroughUrl,
  sessionActive,
  type DriveFailure,
  type MergeConflictState,
} from '../../lib/feature-ui'
import { useReviewArtifacts } from '../../lib/reviews'
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
  // Read once here and handed down: the summary counts the review agent's
  // findings out of these same rows the panel lists, so a count that disagreed
  // with the list below it would be unrepresentable.
  const notes = trpc.notes.list.useQuery(
    { featureId: feature.id },
    { refetchInterval: useLivePoll() },
  )
  const checks = reviewChecks({
    tickets,
    run,
    commitCount: commits.data?.count,
    notes: notes.data,
  })
  // What the review left on disk, over the plain HTTP routes beside tRPC. The
  // walkthrough sits with the summary rather than under the notes: the card
  // above says what the agent found, this one shows it happening.
  const artifacts = useReviewArtifacts(feature.id)
  const walkthrough = reviewWalkthroughUrl(artifacts.data)
  // What a drive on THIS project does — a prepared one renders an environment,
  // runs the setup command and boots a dev server; an unprepared one checks the
  // branch out and stops. The card used to promise the first to everyone.
  // (`useQuery().data` infers to `{}` here — the same tRPC-in-component typing
  // gap the settings overlay documents; the runtime value is a SettingsView.)
  const settings = trpc.settings.get.useQuery({ projectId: feature.projectId })
  const caps = driveCapabilities(settings.data as SettingsView | undefined)
  // A drive whose setup died: the failure rides the polled drive, so it is here
  // for as long as the drive is — not just on the click that caused it.
  const failure = driveFailure(ownDrive, { sessionLive })

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

      {failure && <DriveFailureCard featureId={feature.id} failure={failure} />}

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
        {/* `driving` is this browser's own record of a drive it started, so a
            review drive — started by an agent on the host — is invisible in it.
            The server's `ownDrive` is what knows one is up at all, and reading
            both is what lets this card describe a review drive instead of
            offering to start a drive the server would refuse (decisions #10). */}
        {isDriving || ownDrive ? (
          <DriveStatus branch={driving?.branch ?? ownDrive?.branch ?? ''} drive={ownDrive} />
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
        {ownDrive?.purpose === 'review' && <StopReviewDrive featureId={feature.id} />}
      </div>
      </div>

      {isDriving && ownDrive && <DrivePane drive={ownDrive} />}

      {walkthrough && <WalkthroughCard url={walkthrough} />}

      <NotesPanel
        featureId={feature.id}
        lap={feature.lap}
        tickets={tickets}
        rows={notes.data ?? []}
        readonly={readonly}
      />
    </div>
  )
}

/**
 * The review agent's walkthrough (decisions #8): what it actually did on this
 * branch, recorded as it went, so review can be *consumed* rather than driven —
 * which is the whole point of the video, since driving is the thing the human
 * was skipping.
 *
 * A native `<video>` and no player library: agent-browser records WebM, which
 * browsers play natively, and the route behind this URL answers range requests
 * so scrubbing works. `preload="metadata"` fetches the duration and nothing
 * else — a walkthrough is evidence to reach for, not something to autoload in
 * full every time the review screen opens.
 *
 * Rendered only when a recording exists ({@link reviewWalkthroughUrl} returns
 * null otherwise): a backend review records nothing, and an empty player frame
 * would read as a video that failed to load.
 */
function WalkthroughCard({ url }: { url: string }) {
  return (
    <div className="review-card walkthrough-card">
      <SectionTitle>Review walkthrough</SectionTitle>
      <video className="walkthrough-video" src={url} controls preload="metadata" />
      <div className="drive-copy">
        What the review agent did on this branch, as it did it. What it made of it is in the notes
        below.
      </div>
    </div>
  )
}

/**
 * The findings inbox (decisions.md #11): what was seen while clicking through
 * the branch, grouped under the lap it was seen on. During a drive the human only
 * TYPES — the per-note "→ ticket" is gone, because triage one click at a time was
 * making them do ticket admin mid-drive, and it competed with Iterate with no
 * guidance on which to take. Both roads now leave from one "Address notes" in the
 * next-step bar.
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
 *
 * Notes the review agent wrote are badged (decisions #7) and otherwise identical.
 * The badge says who saw it, not what may be done about it: an agent finding IS
 * the thing the fix loop is meant to consume.
 */
function NotesPanel({
  featureId,
  lap,
  tickets,
  rows,
  readonly,
}: {
  featureId: string
  /** The feature's current lap — the group rendered expanded. */
  lap: number
  tickets: FeatureFull['tickets']
  /** The feature's notes, read by the parent so the summary counts these rows. */
  rows: TestNote[]
  /** Looking back at review on a shipped feature — the checklist, no editing. */
  readonly: boolean
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
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

  // One mutation in flight at a time: the list is about to be refetched, so a
  // second click would act on a row the server is already moving.
  const busy = edit.isPending || remove.isPending || toggle.isPending
  const submit = (): void => {
    if (draft.trim() && !add.isPending) add.mutate({ featureId, text: draft })
  }

  const openCount = rows.filter((n) => n.status === 'open').length
  const meta = [
    `${openCount} open`,
    rows.filter((n) => n.status === 'done').length > 0 &&
      `${rows.filter((n) => n.status === 'done').length} handled`,
    rows.filter((n) => n.status === 'promoted').length > 0 &&
      `${rows.filter((n) => n.status === 'promoted').length} ticketed`,
  ]
    .filter((p): p is string => typeof p === 'string')
    .join(' · ')

  const noteRow = (note: TestNote) => {
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

        <NoteAuthorChip author={note.author} />

        {ticket && (
          <span className="note-ticket" title={ticket.title}>
            #{ticket.seq} {ticket.title}
          </span>
        )}

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
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="review-card notes-card">
      <div className="notes-head">
        <SectionTitle>Test-drive notes</SectionTitle>
        {rows.length > 0 && <span className="body-meta">{meta}</span>}
      </div>

      {!readonly && (
        <>
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
            <Button
              variant="ghost"
              onClick={submit}
              disabled={!draft.trim() || add.isPending}
            >
              {add.isPending ? 'Adding…' : 'Add'}
            </Button>
          </div>
          {/* Where the triage went, said where the buttons used to be — the panel
              is now only for capture, and the fork is one action in the bar. */}
          <div className="notes-hint">
            Just type what you see. When you’re done looking,{' '}
            <strong>Address notes</strong> in the bar above turns the quick fixes into tickets — or
            hands the whole inbox to the next lap’s session.
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <div className="drive-copy">
          Nothing noted yet. Anything you write here lands in the feature’s
          <code> test-notes.md</code>, which the next lap’s session reads.
        </div>
      ) : (
        <div className="notes-list">
          <LapSections
            groups={groupByLap(rows, lap)}
            meta={(g) => `${g.rows.filter((n) => n.status === 'open').length} open`}
          >
            {(group) => group.map(noteRow)}
          </LapSections>
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
 *
 * Who is driving is a separate question from what is running, and {@link
 * driveWheel} answers it: the live state reads "review agent driving" when the
 * drive is the review ticket's own (decisions #10), and is word-for-word the
 * human's when it is not.
 */
function DriveStatus({
  branch,
  drive,
}: {
  branch: string
  drive:
    | { purpose?: 'human' | 'review'; devPaneId?: string; devConfigured: boolean }
    | null
    | undefined
}) {
  const wheel = driveWheel(drive)
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
          <span className="drive-label">{wheel.label}</span>
          <span className="drive-loc">{branch}</span>
        </div>
        <div className="drive-copy">{wheel.copy}</div>
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
 * Stop, for a drive the review agent is holding (decisions #10).
 *
 * The human's own Stop lives in the next-step bar and the status bar, and both
 * are driven by this browser's record of a drive IT started — so a review drive
 * has no stop control anywhere without this one. It needs one: lap 1
 * deliberately made `stop` purpose-blind so the human can reclaim the slot from
 * a review agent that died holding it, and a Stop the server honours but the UI
 * never offers is the same as no Stop at all.
 */
function StopReviewDrive({ featureId }: { featureId: string }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const stop = trpc.feature.testDrive.useMutation({
    onSuccess: () => {
      void utils.feature.driveInfo.invalidate()
      void utils.feature.get.invalidate({ id: featureId })
    },
    onError: (e) => toast.push(e.message),
  })

  return (
    <Button
      variant="ghost"
      className="drive-stop-review"
      disabled={stop.isPending}
      onClick={() => stop.mutate({ featureId, action: 'stop' })}
    >
      Stop the review drive
    </Button>
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
 * The setup-failure card (multi-service decisions 4 and 9). A drive whose setup
 * command failed used to be a toast on the click that caused it and then a panel
 * claiming "driving now" — the human was left mid-review holding a hookFailure
 * blob, at the worst possible moment to start debugging an environment.
 *
 * So the failure gets the loudest surface on the page: the command, how it
 * ended, its own output, and one click that opens an agent already holding all
 * three. The drive is deliberately left running — it holds the feature branch
 * checked out, which is the state the fix session needs.
 *
 * Hidden while a session is live, exactly as the conflict card is: one terminal
 * per feature, and the launcher refuses a second one regardless.
 */
function DriveFailureCard({ featureId, failure }: { featureId: string; failure: DriveFailure }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const fix = trpc.feature.fixDrive.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate({ id: featureId })
      void utils.events.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  return (
    <div className="review-card drive-failure-card">
      <SectionTitle>Drive setup failed</SectionTitle>
      <div className="drive-copy">
        The branch is checked out, but <code>{failure.command}</code> {failure.outcome} — so
        whatever it was meant to bring up is probably not running. An agent can read this failure
        on your machine, repair the environment and retry the drive.
      </div>
      {failure.output && <pre className="drive-failure-output">{failure.output}</pre>}
      {failure.canFix && (
        <Button
          variant="solid"
          className="drive-failure-fix"
          disabled={fix.isPending}
          onClick={() => fix.mutate({ featureId })}
        >
          Fix drive
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
  if (!drive.devPaneId) return null
  const open = openApp(drive)

  return (
    <div className="drive-pane">
      <div className="drive-pane-strip">
        <span className="drive-pane-kind">dev server</span>
        <span className="drive-pane-loc">{drive.branch}</span>
        <span className="drive-pane-spacer" />
        {open &&
          (open.state === 'ready' ? (
            <a className="drive-open" href={open.url} target="_blank" rel="noreferrer noopener">
              Open app ↗
            </a>
          ) : (
            <span className="drive-open drive-open-waiting">{openAppWaitingLabel(open)}</span>
          ))}
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
