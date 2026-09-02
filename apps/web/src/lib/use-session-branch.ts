import { trpc } from '../trpc'
import { sessionBranchState } from './project-workspace'
import { useToast } from './toast'

/**
 * Where the next project chat's work lands, read and written in one place
 * (decisions.md #3).
 *
 * The pick still persists per project — it is the `sessionBranch` setting the
 * base-branch-control feature settled — but it is no longer page chrome: the
 * menu sits beside **New chat**, which is the moment the value applies. So the
 * three queries that used to live in a `SessionLanding` component in the page
 * header live here, behind one object the header line and the card both read.
 */
export interface SessionBranchApi {
  /** The branch the next chat lands on, or null while the query is in flight. */
  value: string | null
  /** Every local branch, or undefined while the list is in flight. */
  branches: string[] | undefined
  /** The repo's main line — the menu's own heading, and the unpicked default. */
  detected: string | undefined
  /** The stored pick is gone from this repo: the one state that blocks a launch. */
  missing: boolean
  pick: (branch: string) => void
  /** A write is in flight; the menu is not answering yet. */
  picking: boolean
}

export function useSessionBranch(projectId: string): SessionBranchApi {
  const utils = trpc.useUtils()
  const toast = useToast()
  const viewQ = trpc.project.sessionBranch.useQuery({ projectId })
  // Existing feature branches are valid landing targets for a project chat.
  // Creation forms intentionally keep the endpoint's narrower default.
  const branchesQ = trpc.project.branches.useQuery({ projectId, includeFeatureBranches: true })
  const landing = sessionBranchState(viewQ.data, branchesQ.data?.branches)
  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      void utils.project.sessionBranch.invalidate()
      // The same value is a row in the settings overlay; one write, both readers.
      void utils.settings.get.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  return {
    value: landing?.value ?? null,
    branches: branchesQ.data?.branches,
    detected: viewQ.data?.detected,
    missing: landing?.origin === 'vanished',
    pick: (value) => update.mutate({ projectId, key: 'sessionBranch', value }),
    picking: update.isPending,
  }
}
