'use client'

import { useState } from 'react'
import { ImageOff, Lock, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VerificationArtifact, ArtifactKind } from '@/lib/api/verification'

// Reviewer-only rendering of a KYC artifact (ID image, selfie, proof of
// address, certificate, portfolio item). Handles slow/failed loads gracefully —
// never a broken-image icon. Every artifact carries descriptive alt text.
//
// These images are visible ONLY inside this reviewer drawer. They are never
// used as the public avatar and their URLs are never logged.

const KIND_LABEL: Record<ArtifactKind, string> = {
  id_document: 'Government ID',
  selfie: 'Liveness selfie',
  proof_of_address: 'Proof of address',
  certificate: 'Certificate',
  portfolio_item: 'Portfolio sample',
}

function ArtifactTile({ artifact }: { artifact: VerificationArtifact }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const kindLabel = KIND_LABEL[artifact.kind]
  const alt = `${kindLabel}: ${artifact.label}`

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="relative aspect-[4/3] w-full">
        {state !== 'error' && (
          // eslint-disable-next-line @next/next/no-img-element -- signed KYC URL, reviewer-only
          <img
            src={artifact.url}
            alt={alt}
            onLoad={() => setState('loaded')}
            onError={() => setState('error')}
            className={cn(
              'size-full object-contain transition-opacity',
              state === 'loaded' ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}

        {/* Loading skeleton */}
        {state === 'loading' && (
          <div
            className="absolute inset-0 animate-pulse bg-slate-100 dark:bg-slate-700"
            aria-hidden="true"
          />
        )}

        {/* Graceful failure — informative, never a broken image */}
        {state === 'error' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-slate-400 dark:text-slate-500"
            role="img"
            aria-label={`${alt} — failed to load`}
          >
            <ImageOff className="size-6" strokeWidth={1.5} />
            <span className="px-3 text-center text-xs">Artifact unavailable</span>
          </div>
        )}
      </div>

      <figcaption className="flex items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
        {artifact.kind === 'certificate' || artifact.kind === 'proof_of_address' ? (
          <FileText className="size-3.5 shrink-0 text-slate-400" />
        ) : (
          <Lock className="size-3.5 shrink-0 text-slate-400" />
        )}
        <span className="truncate">{kindLabel}</span>
        {artifact.doc_type && (
          <span className="ml-auto shrink-0 text-slate-400">{artifact.doc_type}</span>
        )}
      </figcaption>
    </figure>
  )
}

export function ArtifactViewer({ artifacts }: { artifacts: VerificationArtifact[] }) {
  return (
    <section aria-labelledby="artifacts-heading" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3
          id="artifacts-heading"
          className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          Submitted artifacts
        </h3>
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Lock className="size-3" /> Reviewer-only
        </span>
      </div>

      {artifacts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700">
          No artifacts attached to this submission.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {artifacts.map((a) => (
            <ArtifactTile key={a.id} artifact={a} />
          ))}
        </div>
      )}
    </section>
  )
}
