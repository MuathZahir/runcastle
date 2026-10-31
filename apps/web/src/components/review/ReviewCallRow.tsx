import type { PackageCall } from '@runcastle/core'
import { Disclosure, StatusLabel } from '../../ui'
import { statusTone } from '../../lib/feature-ui/api-call'
import { CallResponse } from './ApiView'

/** A call's row: how it answered and what was sent, the detail folded. */
export function ReviewCallRow({ call, defaultOpen = false }: { call: PackageCall; defaultOpen?: boolean }) {
  const { result } = call
  return (
    <Disclosure
      size="sm"
      defaultOpen={defaultOpen}
      aside={result.ok ? `${result.durationMs} ms` : undefined}
      title={
        <span className="flex min-w-0 items-center gap-2">
          {result.ok ? (
            <StatusLabel size="sm" strong tone={statusTone(result.status)}>
              {String(result.status)}
            </StatusLabel>
          ) : (
            <StatusLabel size="sm" strong tone="danger">
              Couldn’t send
            </StatusLabel>
          )}
          <span className="min-w-0 truncate font-mono text-xs text-text-secondary">
            {call.method} {call.url}
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h6 className="m-0 text-xs font-medium text-text-tertiary">Sent</h6>
          <Disclosure size="sm" title={`Headers (${call.headers.length})`}>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
              {call.headers.map(([name, value], i) => (
                <div key={i} className="contents">
                  <dt className="text-text-tertiary">{name}</dt>
                  <dd className="m-0 break-all text-text-secondary">{value}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
          {call.body && (
            <pre className="m-0 max-h-48 overflow-auto rounded-md bg-surface px-2 py-1.5 font-mono text-xs whitespace-pre-wrap text-text">
              {call.body}
            </pre>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h6 className="m-0 text-xs font-medium text-text-tertiary">Answered</h6>
          <CallResponse result={result} />
        </div>
      </div>
    </Disclosure>
  )
}
