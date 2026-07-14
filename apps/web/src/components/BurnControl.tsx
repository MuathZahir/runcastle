import { useState } from 'react'
import type { Phase } from '@runcastle/core'
import { useToast } from '../lib/toast'
import { trpc } from '../trpc'
import { Button, ConfirmDialog } from '../ui'

export function BurnControl({
  featureId,
  phase,
  ticketCount,
}: {
  featureId: string
  phase: Phase
  ticketCount: number
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)

  const burn = trpc.feature.burn.useMutation({
    onError: (e) => {
      setConfirm(false)
      toast.push(e.message)
    },
    onSuccess: () => {
      setConfirm(false)
      toast.push('burn started', 'success')
      utils.feature.get.invalidate({ id: featureId })
      utils.feature.list.invalidate()
    },
  })

  // G3 is satisfiable only in the tickets phase with at least one ticket.
  const enabled = phase === 'tickets' && ticketCount > 0

  return (
    <>
      <Button
        variant="danger"
        disabled={!enabled || burn.isPending}
        onClick={() => setConfirm(true)}
        title={
          enabled
            ? 'Launch one AFK agent per ticket'
            : 'Burn requires the tickets phase with at least one ticket'
        }
      >
        Burn{ticketCount > 0 ? ` (${ticketCount})` : ''}
      </Button>
      {confirm && (
        <ConfirmDialog
          title="Burn tickets"
          message={`Launch ${ticketCount} AFK agent${ticketCount === 1 ? '' : 's'}?`}
          confirmLabel="Burn"
          danger
          busy={burn.isPending}
          onConfirm={() => burn.mutate({ featureId })}
          onCancel={() => setConfirm(false)}
        />
      )}
    </>
  )
}
