import { Dialog, IconButton } from '../../ui'
import { IconX } from '../../icons'

/**
 * A note's picture at full size, in the app (decision 25f).
 *
 * The walked list opened its thumbnails as `<a target="_blank">` onto the raw
 * PNG route, which left the human in a browser tab with a bare image and no way
 * back to the row they were reading. This is the same picture without leaving
 * the page: the foundation `Dialog` owns Escape, the backdrop (`bg-scrim`,
 * fading in), the panel's rise, and the focus restore — so all this adds is the
 * picture on an inset ground and one close control.
 */
export function Lightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!url} onClose={onClose} size="xl" label="the note’s picture" className="overflow-hidden">
      <div className="relative flex flex-col p-2">
        <img
          src={url ?? ''}
          alt="the picture attached to this note"
          className="block max-h-[80vh] w-full rounded-md bg-surface-inset object-contain"
        />
        {/* The ground is on a wrapper: two backgrounds on one element are a
            coin flip without tailwind-merge. */}
        <span className="absolute top-4 right-4 rounded-md bg-surface-raised shadow-popover">
          <IconButton label="Close" size="sm" icon={<IconX />} onClick={onClose} />
        </span>
      </div>
    </Dialog>
  )
}
