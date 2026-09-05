import { Button, Dialog } from '../../ui'

/**
 * A note's picture at full size, in the app (decision 25f).
 *
 * The walked list opened its thumbnails as `<a target="_blank">` onto the raw
 * PNG route, which left the human in a browser tab with a bare image and no way
 * back to the row they were reading. This is the same picture without leaving
 * the page: the foundation `Dialog` owns Escape, the backdrop dismissal and the
 * focus restore, so all this adds is the image and a close.
 */
export function Lightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!url} onClose={onClose} size="xl" label="the note’s picture">
      <div className="relative flex flex-col p-2">
        <img
          src={url ?? ''}
          alt="the picture attached to this note"
          className="max-h-[80vh] w-full rounded-md bg-black object-contain"
        />
        <Button className="absolute top-4 right-4 w-9 px-0" aria-label="close" onClick={onClose}>
          ✕
        </Button>
      </div>
    </Dialog>
  )
}
