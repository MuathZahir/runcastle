import { useState } from 'react'
import type { Phase } from '@runcastle/core'
import { useToast } from '../lib/toast'
import { trpc } from '../trpc'
import { Button, ConfirmDialog } from '../ui'

export function TestDriveMergePanel({
  featureId,
  phase,
}: {
  featureId: string
  phase: Phase
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [denial, setDenial] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [mergeConfirm, setMergeConfirm] = useState(false)

  const testDrive = trpc.feature.testDrive.useMutation({
    onError: (e) => {
      setDenial(null)
      toast.push(e.message)
    },
    onSuccess: (res) => {
      if (res.ok) {
        setDenial(null)
        toast.push(
          res.branch ? `test drive on ${res.branch}` : 'test drive ok',
          'success',
        )
      } else {
        setDenial(res.deniedReason ?? 'denied')
      }
      utils.feature.get.invalidate({ id: featureId })
    },
  })

  const merge = trpc.feature.merge.useMutation({
    onError: (e) => {
      setMergeConfirm(false)
      toast.push(e.message)
    },
    onSuccess: (res) => {
      setMergeConfirm(false)
      if (res.ok) {
        setConflict(false)
        toast.push('merged', 'success')
      } else {
        setConflict(true)
      }
      utils.feature.get.invalidate({ id: featureId })
      utils.feature.list.invalidate()
    },
  })

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">Test drive &amp; merge</h2>
      </div>
      <div className="card-body">
        <div className="row-actions">
          <Button
            variant="default"
            disabled={testDrive.isPending}
            onClick={() => testDrive.mutate({ featureId, action: 'start' })}
          >
            Start test drive
          </Button>
          <Button
            variant="ghost"
            disabled={testDrive.isPending}
            onClick={() => testDrive.mutate({ featureId, action: 'stop' })}
          >
            Stop
          </Button>
          <Button
            variant="primary"
            disabled={phase !== 'review' || merge.isPending}
            onClick={() => setMergeConfirm(true)}
            title={
              phase !== 'review'
                ? 'Merge is available in the review phase'
                : 'Merge the feature branch into main'
            }
          >
            Merge
          </Button>
        </div>
        {denial && (
          <div className="banner-warn">Test drive denied: {denial}</div>
        )}
        {conflict && (
          <div className="banner-error">
            Merge conflict — resolve and retry.
          </div>
        )}
      </div>

      {mergeConfirm && (
        <ConfirmDialog
          title="Merge feature"
          message="Merge this feature branch into the main branch?"
          confirmLabel="Merge"
          busy={merge.isPending}
          onConfirm={() => merge.mutate({ featureId })}
          onCancel={() => setMergeConfirm(false)}
        />
      )}
    </div>
  )
}
