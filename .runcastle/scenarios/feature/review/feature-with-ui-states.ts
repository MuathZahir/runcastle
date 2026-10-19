/**
 * Scenario: a feature at review whose UI states come from this checkout's own
 * stories, built for real.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity and the `.runcastle/drive.env` overlay in
 * its env. Review passes are run by the developer's INSTALLED runcastle, so the
 * driven one never builds a catalogue itself; this scenario does it instead:
 * it registers this checkout as a project in the drive's data dir, seeds a
 * feature at review on the drive's branch (base main), and runs the real
 * `runStoriesBuild` with a sandbox that is the checkout itself. The page then
 * frames the stories from the drive's own stories port.
 *
 * Main has no `.runcastle/stories.json`, so the base is `none` and every story
 * comes back new. No branch, worktree or other ref is made in the repo.
 */
import { randomBytes } from 'node:crypto'
import { emit } from '../../../../packages/server/src/services/events.ts'
import { runStoriesBuild, storiesBuildBranch } from '../../../../packages/server/src/workflows/stories-build.ts'
import {
  checkoutProject,
  checkoutRoot,
  featureUrl,
  headCommit,
  hostSandbox,
  seedFeatureAtReview,
  withDriveDb,
} from '../../_fixtures/ui-states.ts'

try {
  await withDriveDb(async (ctx) => {
    const repoRoot = checkoutRoot()
    const project = await checkoutProject(ctx, repoRoot)
    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')
    const { feature, reviewTicket } = await seedFeatureAtReview(ctx, project, `UI states ${run}`)

    const record = await runStoriesBuild({
      config: ctx.config,
      project,
      feature,
      ticket: reviewTicket,
      sha: await headCommit(repoRoot),
      emit: (e) => emit(ctx, feature.id, e),
      deps: {
        withSandbox: hostSandbox(repoRoot, storiesBuildBranch(reviewTicket.id)),
        // The host sandbox stands in the checkout at HEAD: there is nothing to pin.
        withBranch: (_repo, _branch, _sha, use) => use(),
      },
    })

    const summary =
      record.status === 'built'
        ? `${record.counts.changed} changed, ${record.counts.new} new, ${record.counts.affected} also affected`
        : record.status === 'none'
          ? 'no .runcastle/stories.json at HEAD'
          : record.status === 'failed'
            ? `exit ${record.exitCode}`
            : record.reason
    console.log(`[feature-with-ui-states] ${record.status}: ${summary}`)
    console.log(`ENTRY_URL=${featureUrl(project, feature)}`)
  })
} catch (e) {
  console.error(`[feature-with-ui-states] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
