import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Phase, RunStatus, TicketStatus } from '@runcastle/core'

type Variant = 'primary' | 'danger' | 'ghost' | 'default'

export function Button({
  variant = 'default',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  return <span className={`badge phase-badge phase-${phase}`}>{phase}</span>
}

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  return <span className={`badge chip status-${status}`}>{status}</span>
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <span className={`badge runstatus-${status}`}>{status}</span>
}

export function Modal({
  title,
  wide,
  onClose,
  children,
}: {
  title: string
  wide?: boolean
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="confirm-body">{message}</div>
      <div className="modal-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
