import { Toast } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'stretch',
  width: 360,
}

/** The three tones stacked as they'd appear bottom-right in the app. */
export const Tones = () => (
  <div style={stage}>
    <Toast tone="info">copied fix/ship-path-bugs</Toast>
    <Toast tone="success">shipped auth-flow</Toast>
    <Toast tone="error">merge failed: conflicts in git.ts</Toast>
  </div>
)

/** An error toast on its own. */
export const ErrorOnly = () => (
  <div style={stage}>
    <Toast tone="error">test drive crashed — see run log</Toast>
  </div>
)
