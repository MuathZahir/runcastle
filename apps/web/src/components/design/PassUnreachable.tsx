import { IconPen } from '../../icons'
import { Button, EmptyState } from '../../ui'

/**
 * What a design view shows in place of its frame when this browser cannot
 * reach the design pass-through (decisions 23, 26): which port to forward,
 * with the tunnel that does it, and Retry. Shared by the desktop and the phone.
 * The pass-through sits two ports above runcastle's own.
 */
export function PassUnreachable({ hostname, passPort, onRetry }: { hostname: string; passPort: number; onRetry: () => void }) {
  const appPort = passPort - 2
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16">
      <EmptyState
        className="py-0"
        icon={<IconPen />}
        title="This browser can’t reach the design"
        hint={`The design server runs, but this browser cannot reach port ${passPort} on ${hostname}. Over an SSH tunnel, forward it too:`}
      />
      <code className="max-w-full rounded-md bg-surface-inset px-3 py-2 font-mono text-xs break-all text-text-secondary">
        {`ssh -L ${appPort}:localhost:${appPort} -L ${passPort}:localhost:${passPort} <host>`}
      </code>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  )
}
