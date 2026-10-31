import { useState } from 'react'
import type { ReviewPackage } from '@runcastle/core'
import { useReviewArtifacts, useReviewPackage } from '../../lib/reviews'
import { EvidenceStage } from './EvidenceStage'
import { ReviewPackageCard } from './ReviewPackageCard'
import { ReviewPackagePage } from './ReviewPackagePage'

/** The page with its real walkthrough: the pass's recording on the stage it plays on elsewhere. */
function OpenPackage({ pack, onClose }: { pack: ReviewPackage; onClose: () => void }) {
  const artifacts = useReviewArtifacts(pack.featureId, pack.hasWalkthrough)
  const recording = artifacts.data?.find((row) => row.ticketId === pack.ticketId && row.videoUrl)
  return (
    <ReviewPackagePage
      pack={pack}
      onClose={onClose}
      walkthrough={recording && <EvidenceStage featureId={pack.featureId} recordings={[recording]} notes={[]} readonly />}
    />
  )
}

/** A package opened from outside a chat, by the ticket it belongs to. */
export function ReviewPackageDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { data } = useReviewPackage(ticketId)
  return data ? <OpenPackage pack={data} onClose={onClose} /> : null
}

/** A package in a thread. Nothing shows until it reads, and nothing if its pass is gone. */
export function ReviewPackageItem({ ticketId }: { ticketId: string }) {
  const { data } = useReviewPackage(ticketId)
  const [open, setOpen] = useState(false)
  if (!data) return null
  return (
    <>
      <ReviewPackageCard pack={data} onOpen={() => setOpen(true)} />
      {open && <OpenPackage pack={data} onClose={() => setOpen(false)} />}
    </>
  )
}
