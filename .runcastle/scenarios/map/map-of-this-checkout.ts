/**
 * Scenario: the map of this checkout, its UI states from this checkout's own
 * stories built for real as the project's main catalogue.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity and the `.runcastle/drive.env` overlay in
 * its env. The driven runcastle never builds main's catalogue on its own (the
 * map never builds on open), so this scenario does: it registers this checkout
 * as a project in the drive's data dir and runs the real `buildMainCatalogue`
 * at HEAD with a sandbox that is the checkout itself. The Review group then
 * shows runcastle's Review/… stories beside the scenarios under
 * `scenarios/review/`, framed from the drive's own stories port.
 *
 * No branch, worktree or other ref is made in the repo.
 */
import { buildMainCatalogue, mainBuildBranch } from '../../../packages/server/src/services/main-catalogue.ts'
import { checkoutProject, checkoutRoot, headCommit, hostSandbox, withDriveDb } from '../_fixtures/ui-states.ts'

try {
  await withDriveDb(async (ctx) => {
    const repoRoot = checkoutRoot()
    const project = await checkoutProject(ctx, repoRoot)
    const commit = await headCommit(repoRoot)

    const outcome = await buildMainCatalogue(ctx, project.id, {
      commit,
      deps: {
        withSandbox: hostSandbox(repoRoot, mainBuildBranch(commit)),
        // The host sandbox stands in the checkout at HEAD: there is nothing to pin.
        withBranch: (_repo, _branch, _sha, use) => use(),
      },
    })

    const summary = 'reason' in outcome ? outcome.reason : `at ${commit.slice(0, 7)}`
    console.log(`[map-of-this-checkout] ${outcome.status}: ${summary}`)
    console.log(`ENTRY_URL=/p/${encodeURIComponent(project.id)}/map/review`)
  })
} catch (e) {
  console.error(`[map-of-this-checkout] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
