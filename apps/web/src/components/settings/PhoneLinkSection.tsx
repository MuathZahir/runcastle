import qrcode from 'qrcode-generator'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import type { RouterOutputs } from '../../lib/api'
import type { SearchableSetting } from '../../lib/settings'
import { Button, DimLine, IconButton, LINK, cx } from '../../ui'
import { IconCopy, IconExternalLink } from '../../icons'
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

/**
 * The status the section draws. `httpsNeeded` is the address Tailscale printed
 * when the tailnet has not allowed HTTPS yet (ready-to-publish decision 7);
 * the server fills it once its turn-on reads that answer.
 */
export type PhoneLinkView = PhoneLinkStatus & { httpsNeeded?: string }

/** Tailscale's own page for the tailnet's HTTPS switch, when the CLI printed none. */
export const TAILSCALE_HTTPS_PAGE = 'https://login.tailscale.com/admin/dns'

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
  return (
    <PhoneLinkBody
      link={status.data}
      loading={status.isLoading}
      loadError={status.error?.message}
      turningOn={turnOn.isPending}
      turningOff={turnOff.isPending}
      onTurnOn={() => turnOn.mutate({ projectId })}
      onTurnOff={() => turnOff.mutate({ projectId })}
    />
  )
}

/**
 * The section as it looks, fed its status: what Tailscale on this computer
 * says, then the four steps on the phone (decision 8). The steps show greyed
 * until the link is on, so the whole path is visible before the first click.
 */
export function PhoneLinkBody({
  link,
  loading = false,
  loadError,
  turningOn = false,
  turningOff = false,
  onTurnOn,
  onTurnOff,
}: {
  link: PhoneLinkView | undefined
  loading?: boolean
  loadError?: string
  turningOn?: boolean
  turningOff?: boolean
  onTurnOn: () => void
  onTurnOff: () => void
}) {
  const busy = turningOn || turningOff
  const on = !!(link?.tailscale === 'running' && link.on && link.url)
  return (
    <SettingSection
      title="On your phone"
      description="Open runcastle on your phone over your own private Tailscale network. Nothing is put on the public internet."
    >
      {loading && <DimLine>Checking Tailscale…</DimLine>}
      {loadError && <DimLine>Could not check Tailscale: {loadError}</DimLine>}
      {link?.tailscale === 'missing' && (
        <SettingLine
          label="Tailscale is not installed on this computer"
          description="Install it, sign in, then come back here."
          control={
            <a
              href="https://tailscale.com/download"
              target="_blank"
              rel="noreferrer noopener"
              className={cx(LINK, 'inline-flex items-center gap-1 self-start pt-1 text-sm')}
            >
              Get Tailscale
              <IconExternalLink size={14} />
            </a>
          }
        />
      )}
      {link?.tailscale === 'stopped' && (
        <SettingLine
          label="Tailscale is not running on this computer"
          description="Start Tailscale and sign in, then come back here."
          control={null}
        />
      )}
      {link?.tailscale === 'running' && !link.on && link.httpsNeeded && (
        <HttpsLine url={link.httpsNeeded} busy={busy} retrying={turningOn} onRetry={onTurnOn} />
      )}
      {link?.tailscale === 'running' && !link.on && !link.httpsNeeded && (
        <SettingLine
          label="Private link"
          description="Only your own Tailscale devices can reach it."
          control={
            <Button
              variant="primary"
              loading={turningOn}
              disabled={busy}
              onClick={onTurnOn}
              className="self-start"
            >
              Turn on
            </Button>
          }
        />
      )}
      {on && link?.url && <OnLine url={link.url} busy={busy} turningOff={turningOff} onTurnOff={onTurnOff} />}
      {link && !on && !link.error && <PhoneSteps active={false} />}
      {link?.error && <FailedLine error={link.error} commands={link.commands} />}
    </SettingSection>
  )
}

/**
 * A new tailnet must allow HTTPS once before Tailscale can serve the link
 * (decision 7). Tailscale prints the page that does it; this says it in words
 * and links there.
 */
function HttpsLine({
  url,
  busy,
  retrying,
  onRetry,
}: {
  url: string
  busy: boolean
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <SettingLine
      label="Turn on HTTPS for your tailnet, once"
      description="Tailscale serves the link over HTTPS, and a new tailnet has to allow that one time. Open Tailscale’s page, turn it on, then try again."
      control={
        <div className="flex flex-wrap items-center gap-2 self-start">
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className={cx(LINK, 'inline-flex items-center gap-1 text-sm')}
          >
            Open Tailscale
            <IconExternalLink size={14} />
          </a>
          <Button loading={retrying} disabled={busy} onClick={onRetry}>
            Try again
          </Button>
        </div>
      }
    />
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
      description="It is on. Only your own Tailscale devices can reach it."
      control={
        <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
          <div className="flex shrink-0 flex-col items-start gap-3">
            <QrCode text={url} />
            <span className="inline-flex w-[180px] min-w-0 items-center gap-1 rounded-md bg-surface-inset py-0.5 pr-0.5 pl-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary" title={url}>
                {url}
              </code>
              <IconButton
                label="Copy"
                size="sm"
                icon={<IconCopy />}
                onClick={() => copyText(url, toast)}
              />
            </span>
            <Button size="sm" loading={turningOff} disabled={busy} onClick={onTurnOff}>
              Turn off
            </Button>
          </div>
          <div className="min-w-60 flex-1">
            <PhoneSteps active />
          </div>
        </div>
      }
    />
  )
}

/** The phone's half of the job, in the order it is done (decision 8). */
const PHONE_STEPS: { title: string; detail: string }[] = [
  {
    title: 'Install Tailscale on your phone',
    detail: 'From the App Store or Google Play.',
  },
  {
    title: 'Sign in with the same account',
    detail: 'The Tailscale account this computer uses, so the phone joins the same private network.',
  },
  {
    title: 'Scan the code',
    detail: 'With the phone’s camera. The link opens runcastle in the browser.',
  },
  {
    title: 'Add it to your home screen',
    detail: 'iPhone: Share, then Add to Home Screen. Android: the browser’s menu, then Add to Home screen.',
  },
]

function PhoneSteps({ active }: { active: boolean }) {
  return (
    <div className={active ? undefined : 'py-4'}>
      {!active && <p className="m-0 mb-2.5 text-xs text-text-tertiary">Once the link is on, on your phone:</p>}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {PHONE_STEPS.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <span
              aria-hidden
              className={cx(
                'flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-xs',
                active ? 'bg-surface-selected text-text' : 'bg-surface-inset text-text-tertiary',
              )}
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className={cx('block text-sm', active ? 'text-text' : 'text-text-secondary')}>{step.title}</span>
              <span className="block text-xs text-pretty text-text-tertiary">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      {active && (
        <p className="m-0 mt-4 text-xs text-pretty text-text-tertiary">
          Then turn on notifications from the last row of the phone’s feature list. On an iPhone they only work from
          the home-screen app.
        </p>
      )}
    </div>
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
