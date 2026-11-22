import { useMemo } from 'react'
import { INVOLVEMENT_LABEL, INVOLVEMENT_NAME, type Involvement } from '@runcastle/core'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { useLivePoll } from '../../lib/live'
import type { FeatureListItem } from '../../lib/api'
import { InvolvementSelect, SetAllInvolvement } from './Involvement'

/**
 * "Involve me in" wired to the server (docs/features/how-involved-am-i): the
 * saves behind the approved pickers in `Involvement.tsx`, and the two pickers
 * that read their feature or epic themselves.
 */

/** Whether a feature's level can still change: a shipped or archived one keeps the level it had. */
export function involvementOpen(feature: Pick<FeatureListItem, 'status'>): boolean {
  return feature.status !== 'shipped' && feature.status !== 'archived'
}

/** The level of each feature of an epic that "Set all to…" would change (decision 4): neither shipped nor archived. */
export function epicLevels(features: readonly FeatureListItem[], chatId: string): Involvement[] {
  return features.filter((f) => f.chatId === chatId && involvementOpen(f)).map((f) => f.involvement)
}

/** A level said as the toast says it: "Involve me in Result only". */
const said = (level: Involvement) => `${INVOLVEMENT_NAME} ${INVOLVEMENT_LABEL[level]}`

/**
 * Saving a level, one feature's or an epic's. A save stays pending until the
 * feature list has read it back, so a picker shows the level it was given
 * (`pendingFor`) rather than flick back to the old one in between. A refusal
 * toasts; a save says what it did only when asked to (`title`), as a picker
 * away from the feature does.
 */
export function useSetInvolvement() {
  const utils = trpc.useUtils()
  const toast = useToast()
  const refresh = () =>
    Promise.all([utils.feature.get.invalidate(), utils.feature.list.invalidate(), utils.events.invalidate()])
  const one = trpc.feature.setInvolvement.useMutation({ onSuccess: refresh, onError: (e) => toast.push(e.message) })
  const all = trpc.feature.setEpicInvolvement.useMutation({ onSuccess: refresh, onError: (e) => toast.push(e.message) })
  const { mutate: mutateOne, isPending: onePending, variables: oneVars } = one
  const { mutate: mutateAll, isPending: allPending, variables: allVars } = all
  return useMemo(
    () => ({
      /** Set one feature's level; with its `title`, a toast says so. */
      set: (featureId: string, level: Involvement, title?: string) =>
        mutateOne(
          { featureId, level },
          title ? { onSuccess: () => toast.push(`${title}: ${said(level)}`, 'success') } : undefined,
        ),
      /** Set every open feature of the epic `chatId`; `n` is how many the picker said it changes. */
      setAll: (chatId: string, level: Involvement, n: number) =>
        mutateAll(
          { chatId, level },
          { onSuccess: () => toast.push(`${n === 1 ? 'The feature' : `All ${n} features`}: ${said(level)}`, 'success') },
        ),
      /** The level a save in flight is giving `featureId`, or undefined. */
      pendingFor: (featureId: string): Involvement | undefined =>
        onePending && oneVars?.featureId === featureId ? oneVars.level : undefined,
      /** The level a "Set all to…" in flight is giving the epic `chatId`, or undefined. */
      pendingForEpic: (chatId: string): Involvement | undefined =>
        allPending && allVars?.chatId === chatId ? allVars.level : undefined,
    }),
    [mutateOne, mutateAll, toast, onePending, oneVars, allPending, allVars],
  )
}

/** What {@link useSetInvolvement} hands a picker. */
export type InvolvementSaver = ReturnType<typeof useSetInvolvement>

/**
 * What a feature's own picker shows and does (decision 3): the level a save in
 * flight is giving it, else its own; still while that save is in flight, and
 * for good once the feature has shipped or been archived. The header's picker
 * and the phone's sheet both read it.
 */
export function featureInvolvement(
  feature: Pick<FeatureListItem, 'id' | 'status' | 'involvement'>,
  save: Pick<InvolvementSaver, 'set' | 'pendingFor'>,
): { value: Involvement; onChange: (level: Involvement) => void; disabled: boolean } {
  const pending = save.pendingFor(feature.id)
  return {
    value: pending ?? feature.involvement,
    onChange: (level) => save.set(feature.id, level),
    disabled: pending !== undefined || !involvementOpen(feature),
  }
}

/** A feature's picker in its page header, saved quietly: the picker itself shows the new level. */
export function FeatureInvolvement({
  feature,
  save,
}: {
  feature: Pick<FeatureListItem, 'id' | 'status' | 'involvement'>
  save: Pick<InvolvementSaver, 'set' | 'pendingFor'>
}) {
  return <InvolvementSelect {...featureInvolvement(feature, save)} size="md" />
}

/**
 * "Set all to…" on an epic's header (decisions 4, 7): the level of every
 * feature of the epic that has not shipped, from the feature list the sidebar
 * reads. Nothing when the epic holds no such feature.
 */
export function EpicInvolvement({ projectId, chatId }: { projectId: string; chatId: string }) {
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const levels = epicLevels(list.data ?? [], chatId)
  return levels.length > 0 ? <SetAllForEpic chatId={chatId} levels={levels} /> : null
}

/** "Set all to…" over levels the epic has, saving a pick for all of them. */
function SetAllForEpic({ chatId, levels }: { chatId: string; levels: Involvement[] }) {
  const save = useSetInvolvement()
  const pending = save.pendingForEpic(chatId)
  return (
    <SetAllInvolvement
      levels={pending ? levels.map(() => pending) : levels}
      onSetAll={(level) => save.setAll(chatId, level, levels.length)}
      disabled={pending !== undefined}
    />
  )
}
