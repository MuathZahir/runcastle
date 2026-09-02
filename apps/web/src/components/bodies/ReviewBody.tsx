import { useRef, useState, type RefObject } from 'react'
import { fmtClock, type ReviewFinding, type TestNote } from '@runcastle/core'
import { Button, CheckLine, LapSections, NoteAuthorChip, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { FeatureFull, SettingsView } from '../../lib/api'
import type { DriveState } from '../../lib/workspace'
import { driveCapabilities } from '../../lib/prep-findings'
import { testDriveExplainer } from '../../lib/vocabulary'
import {
  activeSession,
  deferredScope,
  driveFailure,
  driveWheel,
  groupByLap,
  headline,
  lapAccount,
  latestRun,
  ONE_TERMINAL_WARNING,
  openApp,
  openAppWaitingLabel,
  reviewChecks,
  reviewWalkthroughUrl,
  specDocPath,
  type DriveFailure,
  type LapAccount,
  type MergeConflictState,
} from '../../lib/feature-ui'
import { useReviewArtifacts } from '../../lib/reviews'
import { fmtDateTime, relTime } from '../../lib/format'
import { useLivePoll } from '../../lib/live'
import { useResolveConflict } from '../../lib/use-resolve-conflict'
import { useToast } from '../../lib/toast'
import { ErrorBoundary } from '../ErrorBoundary'
import { Markdown } from '../Markdown'
import { FindingsSummaryBlock, OpenDefectsCard } from '../ReviewFindings'
import { SessionPanel } from '../SessionPanel'
import { TerminalView } from '../TerminalView'
import { WalkthroughPlayer, type SeekWalkthrough } from '../WalkthroughPlayer'

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
  // The feature's open terminal, if it has one. The conflict card no longer
  // HIDES behind it (decisions #10) — it ends this session on its way into the
  // resolve one — but the drive-failure card still does, and an ENDED session
  // (which the panel still renders, with its Resume) is not one either way.
  const liveSession = activeSession(full.sessions)
  const sessionLive = !!liveSession
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
  // The human's own test-drive notes — read once here and handed down to the
  // panel. Nothing but the human writes these any more: the review agent reports
  // structured findings instead (`report_finding`), which is the query below.
  const notes = trpc.notes.list.useQuery(
    { featureId: feature.id },
    { refetchInterval: useLivePoll() },
  )
  // What the review agent found, typed and counted server-side — the counts line
  // and the open-defects list below both come out of this one read, and the
  // next-step bar reads the same query key, so the button that offers to fix N
  // defects and the list of them cannot disagree.
  const findings = trpc.findings.listByFeature.useQuery(
    { featureId: feature.id },
    { refetchInterval: useLivePoll() },
  )
  const checks = reviewChecks({
    tickets,
    run,
    commitCount: commits.data?.count,
    findings: findings.data?.findings.length,
  })
  // What the lap delivered, in the agents' own prose (decisions #8) — the thing
  // the human came to this screen to read, so it leads the card the figures are
  // on rather than sitting under them. Scoped to the lap this page is reviewing:
  // the ledger below groups by lap, and a summary card silently answering with
  // the previous lap's account is the same flat reading the lap work removed.
  const account = lapAccount(tickets, feature.lap)
  // Scope the spec left for a later lap. Same read the next-step bar makes (one
  // query key, one fetch), so the card below and the bar above cannot disagree
  // about whether this lap is the last one.
  const specRelPath = specDocPath(full)
  const specQ = trpc.docs.read.useQuery(
    { featureId: feature.id, relPath: specRelPath ?? 'spec.md' },
    { enabled: !!specRelPath },
  )
  const laterLaps = deferredScope(specQ.data?.content)
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
  // Jump to this moment (decisions #12). The player and the notes list are
  // siblings, so a timestamp click travels up to the one parent they share: the
  // player writes its seek in here while it is mounted, and the rows below call
  // whatever is in it. Nothing fills it when there is no recording on the page,
  // and the timestamps down there stay plain text.
  const seekWalkthrough = useRef<SeekWalkthrough | null>(null)

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
          liveSessionId={liveSession?.id ?? null}
        />
      )}

      {failure && <DriveFailureCard featureId={feature.id} failure={failure} />}

      <div className="review-grid">
      <div className="review-card">
        <SectionTitle>Summary</SectionTitle>
        {account && <LapAccountBlock account={account} />}
        <FindingsSummaryBlock
          summary={findings.data?.summary}
          findings={findings.data?.findings ?? []}
        />
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

      <OpenDefects
        featureId={feature.id}
        open={findings.data?.openDefects ?? []}
        readonly={readonly}
      />

      {laterLaps && <PlannedNextLapCard lap={feature.lap} scope={laterLaps} readonly={readonly} />}

      {isDriving && ownDrive && <DrivePane drive={ownDrive} />}

      {walkthrough && (
        <WalkthroughCard
          url={walkthrough}
          featureId={feature.id}
          readonly={readonly}
          seekRef={seekWalkthrough}
        />
      )}

      <NotesPanel
        featureId={feature.id}
        lap={feature.lap}
        tickets={tickets}
        rows={notes.data ?? []}
        readonly={readonly}
        onJump={walkthrough ? (seconds) => seekWalkthrough.current?.(seconds) : undefined}
      />
    </div>
  )
}

/**
 * What this lap landed, in prose, at the top of the summary card (decisions #8).
 * The human arrives at review to read what the lap did — not a changed-files
 * list, not hunks — and the only account worth leading with comes from an agent
 * that was there.
 *
 * The review agent's own digest is that account: it ran last, held the spec plus
 * every implementation digest, and actually saw the result working. The burners'
 * per-ticket digests are the fallback, and they are LABELLED as the fallback,
 * because several agents each saying what they did is a different (and weaker)
 * thing than one account of the lap.
 */
function LapAccountBlock({ account }: { account: LapAccount }) {
  return (
    <div className="lap-account">
      <div className="lap-account-head">What landed this lap</div>
      {account.source === 'review' ? (
        <Markdown source={account.prose} className="lap-account-prose" />
      ) : (
        <>
          <div className="lap-account-note">
            No review summary this lap — below is each burner’s own account of the ticket it ran.
          </div>
          {account.entries.map((entry) => (
            <div key={entry.seq} className="lap-account-entry">
              <div className="lap-account-ticket">
                #{entry.seq} {entry.title}
              </div>
              <Markdown source={entry.digest} className="lap-account-prose" />
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/**
 * Dismiss, wired: the card itself is hook-free (so the rendering is testable and
 * the counts come from one read), and this is the mutation behind its per-row
 * button. Dismissing is how the open count reaches zero without a burn — a
 * defect the human judged shippable is a decision, not a fix (decisions #7).
 */
function OpenDefects({
  featureId,
  open,
  readonly,
}: {
  featureId: string
  open: ReviewFinding[]
  readonly: boolean
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const dismiss = trpc.findings.dismiss.useMutation({
    onSuccess: () => void utils.findings.listByFeature.invalidate({ featureId }),
    onError: (e) => toast.push(e.message),
  })

  return (
    <OpenDefectsCard
      open={open}
      busy={dismiss.isPending}
      readonly={readonly}
      onDismiss={(findingId) => dismiss.mutate({ findingId })}
    />
  )
}

/**
 * The scope this spec deliberately deferred (decisions #7), shown verbatim beside
 * what the lap delivered.
 *
 * This card is the answer to the story the whole feature is about: a spec written
 * as a thin lap 1 reached review, nothing on the page knew a lap 2 was planned,
 * and the human shipped half a feature by clicking the main button. The bar above
 * has already flipped its primary to Start lap N+1; this is what that button is
 * for, in the spec's own words.
 */
function PlannedNextLapCard({
  lap,
  scope,
  readonly,
}: {
  lap: number
  scope: string
  /** Looking back at review on a shipped feature — there is no next step to take. */
  readonly: boolean
}) {
  return (
    <div className="review-card planned-lap-card">
      <SectionTitle>Planned next lap</SectionTitle>
      <div className="drive-copy">
        {readonly
          ? `The spec kept this out of lap ${lap} on purpose, and it was still deferred when this feature shipped.`
          : `The spec kept this out of lap ${lap} on purpose. Start lap ${lap + 1} from the next step to take it on — or ship what landed, if lap ${lap} is enough.`}
      </div>
      <Markdown source={scope} className="planned-lap-scope" />
    </div>
  )
}

/**
 * The review agent's walkthrough (decisions #8): what it actually did on this
 * branch, recorded as it went, so review can be *consumed* rather than driven —
 * which is the whole point of the video, since driving is the thing the human
 * was skipping.
 *
 * A hand-built player and no player library: agent-browser records WebM, which
 * browsers play natively, and the route behind this URL answers range requests
 * so scrubbing works. The controls are custom because the frame is a drawing
 * surface — see {@link WalkthroughPlayer}.
 *
 * Rendered only when a recording exists ({@link reviewWalkthroughUrl} returns
 * null otherwise): a backend review records nothing, and an empty player frame
 * would read as a video that failed to load.
 */
function WalkthroughCard({
  url,
  featureId,
  readonly,
  seekRef,
}: {
  url: string
  featureId: string
  readonly: boolean
  /** Where the player publishes its seek, for the notes list below to reach. */
  seekRef: RefObject<SeekWalkthrough | null>
}) {
  return (
    <div className="review-card walkthrough-card">
      <SectionTitle>Review walkthrough</SectionTitle>
      <WalkthroughPlayer url={url} featureId={featureId} readonly={readonly} seekRef={seekRef} />
      <div className="drive-copy">
        What the review agent did on this branch, as it did it. Pause on anything that looks wrong
        and Annotate it — the drawing lands in the notes below.
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
  onJump,
}: {
  featureId: string
  /** The feature's current lap — the group rendered expanded. */
  lap: number
  tickets: FeatureFull['tickets']
  /** The feature's notes, read by the parent so the summary counts these rows. */
  rows: TestNote[]
  /** Looking back at review on a shipped feature — the checklist, no editing. */
  readonly: boolean
  /** Send the walkthrough above to a moment, when there is a walkthrough above. */
  onJump?: (seconds: number) => void
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

  // The inbox's standing tally, in the same shape the ticket ledger's meta line
  // uses: what is still open always, the rest only once there is any of it.
  const count = (status: TestNote['status']) => rows.filter((n) => n.status === status).length
  const metaParts = [`${count('open')} open`]
  if (count('done') > 0) metaParts.push(`${count('done')} handled`)
  if (count('promoted') > 0) metaParts.push(`${count('promoted')} ticketed`)
  const meta = metaParts.join(' · ')

  const noteRow = (note: TestNote) => {
    const ticket = note.ticketId ? tickets.find((t) => t.id === note.ticketId) : undefined
    const open = note.status === 'open'
    // The moment in the walkthrough this note was taken from, when it came from
    // one at all — plain notes have none and render exactly as they always did.
    const moment = note.videoTimestamp

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

        {/* An annotated note carries a picture of what it is about (decisions
            #3). The full PNG opens in a tab — the row is a list, not a viewer.
            The moment it was taken at used to hide in this tooltip; it is the
            control beside it now. */}
        {note.screenshotUrl && (
          <a
            className="note-shot"
            href={note.screenshotUrl}
            target="_blank"
            rel="noreferrer noopener"
            title="the annotated frame"
          >
            <img src={note.screenshotUrl} alt="the annotated frame this note is about" />
          </a>
        )}

        {/* Jump to this moment (decisions #12): the stored timestamp is a
            control, not a caption — clicking it sends the player above to that
            frame and pauses on it. With no recording on the page there is
            nowhere to send it, so it stays the label it used to be. */}
        {moment !== undefined &&
          (onJump ? (
            <button
              type="button"
              className="note-at"
              title="jump the walkthrough to this moment"
              onClick={() => onJump(moment)}
            >
              {fmtClock(moment)}
            </button>
          ) : (
            <span className="note-at" title="the moment in the walkthrough this was seen at">
              {fmtClock(moment)}
            </span>
          ))}

        <NoteText text={note.text} />

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
            currentLap={lap}
            meta={(g) => `${g.rows.filter((n) => n.status === 'open').length} open`}
          >
            {(group) => group.map(noteRow)}
          </LapSections>
        </div>
      )}
    </div>
  )
}

/**
 * A note, compact (decisions #4): its first line on the row, the rest one click
 * away. The human's own notes get this too — the panel stops being a wall in
 * every case, and the capture, edit and promote flows are untouched.
 *
 * A note that already fits on its row renders as the plain text it always was,
 * with no disclosure to click: most notes are one short sentence, and a triangle
 * that opens nothing is worse than no triangle.
 */
function NoteText({ text }: { text: string }) {
  const { head, rest } = headline(text)
  return (
    <span className="note-text">
      {rest ? (
        <details className="note-more">
          <summary>{head}</summary>
          <div className="note-rest">{rest}</div>
        </details>
      ) : (
        text
      )}
    </span>
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
 * Merge & ship, listing the conflicting files. Its button opens a revisit session
 * whose first message briefs the merge-into-feature resolution (base branch +
 * file list), so the agent resolves in the talk worktree and the human retries
 * Merge & ship.
 *
 * The button NEVER hides (decisions #10). It used to disappear whenever any
 * session was live — the one-terminal rule, enforced by the launcher's
 * `assertSpawnable` — which read as the button randomly not existing until the
 * chat was ended. With a session live it becomes "End session & resolve",
 * performs that dance in one click, and says so underneath.
 */
function ConflictCard({
  featureId,
  branch,
  conflict,
  liveSessionId,
}: {
  featureId: string
  branch: string
  conflict: MergeConflictState
  /** The terminal the resolve has to close first, or null when none is open. */
  liveSessionId: string | null
}) {
  const resolve = useResolveConflict(featureId, branch)

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
      <Button
        variant="solid"
        className="conflict-resolve"
        disabled={resolve.pending}
        onClick={() => void resolve.resolve(conflict, liveSessionId ?? undefined)}
      >
        {liveSessionId ? 'End session & resolve' : 'Resolve with agent'}
      </Button>
      {/* What the compound costs, said before the click — the honesty that
          replaces the button hiding itself. */}
      {liveSessionId && <div className="conflict-note">{ONE_TERMINAL_WARNING}</div>}
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
