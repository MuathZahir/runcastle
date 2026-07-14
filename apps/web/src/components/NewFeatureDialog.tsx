import { useState } from 'react'
import type { FeatureSize } from '@runcastle/core'
import { navigate } from '../lib/router'
import { useToast } from '../lib/toast'
import { trpc } from '../trpc'
import { Button, Modal } from '../ui'

export function NewFeatureDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [size, setSize] = useState<FeatureSize>('full')

  const create = trpc.feature.create.useMutation({
    onError: (e) => toast.push(e.message),
    onSuccess: (feature) => {
      utils.feature.list.invalidate()
      onClose()
      navigate({ name: 'feature', id: feature.id })
    },
  })

  return (
    <Modal title="New feature" onClose={onClose}>
      <div className="field">
        <label>Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add dark mode toggle"
          autoFocus
        />
      </div>
      <div className="field">
        <label>One-liner</label>
        <input
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          placeholder="Let users switch between light and dark themes"
        />
      </div>
      <div className="field">
        <label>Size</label>
        <div className="toggle">
          <button
            type="button"
            className={size === 'full' ? 'active' : ''}
            onClick={() => setSize('full')}
          >
            full
          </button>
          <button
            type="button"
            className={size === 'collapsed' ? 'active' : ''}
            onClick={() => setSize('collapsed')}
          >
            collapsed
          </button>
        </div>
        <p className="muted small">
          collapsed skips the spec phase (small features).
        </p>
      </div>
      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!title.trim() || create.isPending}
          onClick={() =>
            create.mutate({
              title: title.trim(),
              oneLiner: oneLiner.trim(),
              size,
            })
          }
        >
          {create.isPending ? 'Creating…' : 'Create feature'}
        </Button>
      </div>
    </Modal>
  )
}
