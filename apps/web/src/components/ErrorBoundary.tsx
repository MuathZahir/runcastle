import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Error boundary specifically for TerminalView (UI-SPEC §6): if W1's terminal
 * frontend throws, the rest of the shell keeps working and the failure surfaces
 * as one dim mono line, never a white screen.
 */
interface Props {
  children: ReactNode
  label?: string
  /**
   * Replaces the one-line fallback for a boundary whose blast radius deserves a
   * fuller story — the feature view passes the feature's identity and a way to
   * copy the crash details (findings F19).
   */
  fallback?: (error: Error) => ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[runcastle] boundary caught', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error)
      return (
        <div className="boundary-fallback">
          <span className="font-mono text-sm text-text-3">
            {this.props.label ?? 'component'} failed: {this.state.error.message}
          </span>
        </div>
      )
    }
    return this.props.children
  }
}
