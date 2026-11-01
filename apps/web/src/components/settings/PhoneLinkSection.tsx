import qrcode from 'qrcode-generator'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import type { RouterOutputs } from '../../lib/api'
import type { SearchableSetting } from '../../lib/settings'
import { Button, DimLine, IconButton, LINK } from '../../ui'
import { IconCopy } from '../../icons'
import { copyText } from '../workspace/copy-text'
import { SettingLine, SettingSection } from './SettingRow'
import { showsSetting, type FilterState } from './types'

/**
 * "On your phone" (runcastle-on-your-phone, decision 6): the private Tailscale
 * link, turned on and off with one button, and a QR code that puts it on the
 * phone. When the button cannot do it, the exact commands are shown instead.
 */

/** The section's filter id. It is no setting key: the link lives in Tailscale. */
export const PHONE_LINK_FIELD = 'phone-link'

/** The section names itself to Settings search, as the theme row does. */
export const PHONE_LINK_SEARCH: SearchableSetting = {
  id: PHONE_LINK_FIELD,
  page: 'general',
  terms: ['On your phone', 'Phone', 'Mobile', 'Tailscale', 'QR code', 'Private link'],
}

type PhoneLinkStatus = RouterOutputs['phoneLink']['status']

export function PhoneLinkSection({
  projectId,
  filter,
}: {
  projectId: string
  filter: FilterState
}) {
  const utils = trpc.useUtils()
  const status = trpc.phoneLink.status.useQuery(undefined, { refetchOnWindowFocus: false })
  // Each mutation answers the fresh status, so the section updates at once
  // without asking the CLI again.
  const settle = {
    onSuccess: (next: PhoneLinkStatus) => utils.phoneLink.status.setData(undefined, next),
  }
  const turnOn = trpc.phoneLink.turnOn.useMutation(settle)
  const turnOff = trpc.phoneLink.turnOff.useMutation(settle)

  if (!showsSetting(filter, PHONE_LINK_FIELD)) return null
  const link = status.data
  const busy = turnOn.isPending || turnOff.isPending

  return (
    <SettingSection title="On your phone">
      {status.isLoading && <DimLine>Checking Tailscale…</DimLine>}
      {status.error && <DimLine>Could not check Tailscale: {status.error.message}</DimLine>}
      {link?.tailscale === 'missing' && (
        <SettingLine
          label="Tailscale is not installed"
          description="The phone reaches runcastle through your own Tailscale network."
          control={
            <a
              href="https://tailscale.com/download"
              target="_blank"
              rel="noreferrer noopener"
              className={LINK}
            >
              Get Tailscale
            </a>
          }
        />
      )}
      {link?.tailscale === 'stopped' && (
        <SettingLine
          label="Tailscale is not running"
          description="Start Tailscale on this computer and sign in, then come back here."
          control={null}
        />
      )}
      {link?.tailscale === 'running' && !link.on && (
        <SettingLine
          label="Private link"
          description="Only your own Tailscale devices can reach it."
          control={
            <Button
              variant="primary"
              loading={turnOn.isPending}
              disabled={busy}
              onClick={() => turnOn.mutate({ projectId })}
              className="self-start"
            >
              Turn on
            </Button>
          }
        />
      )}
      {link?.tailscale === 'running' && link.on && link.url && (
        <OnLine
          url={link.url}
          busy={busy}
          turningOff={turnOff.isPending}
          onTurnOff={() => turnOff.mutate({ projectId })}
        />
      )}
      {link?.on && (
        <DimLine>Turn on notifications from your phone: it’s the last row of the feature list.</DimLine>
      )}
      {link?.error && <FailedLine error={link.error} commands={link.commands} />}
    </SettingSection>
  )
}

function OnLine({
  url,
  busy,
  turningOff,
  onTurnOff,
}: {
  url: string
  busy: boolean
  turningOff: boolean
  onTurnOff: () => void
}) {
  const toast = useToast()
  return (
    <SettingLine
      stacked
      label="Private link"
      description="Install Tailscale on your phone, sign in, then scan this. Add it to your home screen from the browser's menu."
      control={
        <div className="flex flex-wrap items-start gap-6">
          <QrCode text={url} />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
            <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-surface-inset py-0.5 pr-0.5 pl-2">
              <code className="min-w-0 truncate font-mono text-xs text-text-secondary" title={url}>
                {url}
              </code>
              <IconButton
                label="Copy"
                size="sm"
                icon={<IconCopy />}
                onClick={() => copyText(url, toast)}
              />
            </span>
            <Button loading={turningOff} disabled={busy} onClick={onTurnOff}>
              Turn off
            </Button>
          </div>
        </div>
      }
    />
  )
}

function FailedLine({ error, commands }: { error: string; commands: string[] }) {
  const toast = useToast()
  const script = commands.join('\n')
  return (
    <SettingLine
      stacked
      label="Could not change the link"
      description={<span className="whitespace-pre-wrap text-danger-text">{error}</span>}
      control={
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-tertiary">Run these on this computer instead:</span>
          <div className="flex items-start gap-1 rounded-md bg-surface-inset py-1.5 pr-1 pl-3">
            <pre className="m-0 min-w-0 flex-1 overflow-x-auto font-mono text-xs text-text-secondary">
              {script}
            </pre>
            <IconButton
              label="Copy"
              size="sm"
              icon={<IconCopy />}
              onClick={() => copyText(script, toast)}
            />
          </div>
        </div>
      }
    />
  )
}

/** Light modules around the code, so a reader finds its edges on any ground. */
const QUIET_ZONE = 4

/**
 * The link as a QR code: inline SVG drawn from the code's modules, never an
 * external image — the link must not leave this machine.
 */
export function QrCode({ text }: { text: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`
    }
  }
  const size = count + QUIET_ZONE * 2
  return (
    <svg
      role="img"
      aria-label={`QR code for ${text}`}
      viewBox={`0 0 ${size} ${size}`}
      width={180}
      height={180}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-md"
    >
      {/* The one literal colour exception: phone cameras read a QR code as dark
          on light, so it keeps a fixed white ground and black modules in both
          themes — the dark theme's tokens would invert it. */}
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
