import qrcode from 'qrcode-generator'

/** Light modules around the code, so a reader finds its edges on any ground. */
const QUIET_ZONE = 4

/**
 * The link as a QR code: inline SVG drawn from the code's modules, never an
 * external image — the link must not leave this machine.
 *
 * Its own module so the QR encoder loads only when a code is first shown
 * (a-faster-web-app decision 9); `PhoneLinkSection` reaches it through `lazy.tsx`.
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
