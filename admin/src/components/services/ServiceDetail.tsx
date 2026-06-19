'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Eye, ShieldCheck, ExternalLink, ImageIcon, Tag, ScrollText,
  AlertTriangle, Trash2, Phone, Star, Calendar, Image as ImgIcon,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { StatusPill } from '@/components/ui/StatusPill'
import { AuditTrail } from '@/components/ui/AuditTrail'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { cn, fmtDate, fmtZMW } from '@/lib/utils'
import { bandLabel } from '@/lib/api/categories'
import {
  servicesApi,
  photoUrl,
  STATUS_LABEL,
  STATUS_VARIANT,
  PRICING_LABEL,
  flagLabel,
  type ServiceDetail as ServiceDetailType,
  type ServicePhotoResult,
  type ServiceFlag,
} from '@/lib/api/services'
import { ServiceModerationActions } from '@/components/services/ServiceModerationActions'

interface Props {
  serviceId: string
}

export function ServiceDetail({ serviceId }: Props) {
  const qc = useQueryClient()

  const { data: service, isLoading } = useQuery({
    queryKey: ['service', serviceId],
    queryFn: () => servicesApi.detail(serviceId),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['service', serviceId] })
    qc.invalidateQueries({ queryKey: ['services'] })
  }

  if (isLoading || !service) return <DetailSkeleton />

  const readOnly = service.status === 'HIDDEN'

  return (
    <div className="space-y-5">
      {/* ── Listing header ── */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-medium text-slate-900 dark:text-slate-100">{service.title}</h3>
          <StatusPill label={STATUS_LABEL[service.status]} variant={STATUS_VARIANT[service.status]} />
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {PRICING_LABEL[service.pricing_model]}
          {service.base_price !== null && service.pricing_model !== 'QUOTE' && <> · {fmtZMW(service.base_price)}</>}
          {service.duration_estimate_mins && <> · ~{service.duration_estimate_mins} min</>}
          <> · listed {fmtDate(service.created_at)}</>
        </p>
      </div>

      {/* ── Read-only / taken-down banner ── */}
      {(readOnly || service.status === 'DRAFT') && service.moderation_reason && (
        <div
          className={cn(
            'rounded-lg border p-3 text-sm',
            readOnly
              ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20'
              : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20',
          )}
        >
          <p className={cn('font-medium', readOnly ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>
            {readOnly ? 'Listing hidden — read-only' : 'Sent back to provider for changes'}
          </p>
          <p className={cn('mt-1', readOnly ? 'text-red-600/90 dark:text-red-300/90' : 'text-amber-700/90 dark:text-amber-300/90')}>
            <span className="font-medium">Reason:</span> {service.moderation_reason}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Full action history is in the audit trail below.
          </p>
        </div>
      )}

      {/* ── Policy + flags ── */}
      {service.flags.length > 0 && (
        <Section title="Flags & policy checks" icon={AlertTriangle}>
          <FlagList flags={service.flags} />
        </Section>
      )}

      {/* ── In-flight bookings advisory ── */}
      {service.in_flight_bookings > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900/50 dark:bg-blue-950/20">
          <p className="flex items-center gap-1.5 font-medium text-blue-700 dark:text-blue-400">
            <Calendar className="size-4" />
            {service.in_flight_bookings} in-flight booking{service.in_flight_bookings === 1 ? '' : 's'}
          </p>
          <p className="mt-1 text-blue-700/90 dark:text-blue-300/90">
            Hiding or taking down this listing removes it from discovery but does not affect these
            bookings — historical references stay intact.
          </p>
        </div>
      )}

      {/* ── Listing as customers see it ── */}
      <Section title="Listing (as customers see it)" icon={Eye}>
        {service.description ? (
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{service.description}</p>
        ) : (
          <p className="text-sm text-slate-400">No description.</p>
        )}

        {service.inclusions.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Inclusions</p>
            <ul className="list-inside list-disc space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
              {service.inclusions.map((inc, i) => (
                <li key={i}>{inc}</li>
              ))}
            </ul>
          </div>
        )}

        {service.addons.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Add-ons</p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {service.addons.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span className="text-slate-700 dark:text-slate-300">{a.name}</span>
                  <span className="text-slate-500">{fmtZMW(a.price)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── Photos + §5.3 pipeline results (read-only) ── */}
      <Section title={`Photos (${service.photos.length})`} icon={ImageIcon}>
        {service.photos.length === 0 ? (
          <p className="text-sm text-slate-400">No photos on this listing.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {service.photos.map((p) => (
              <PhotoCard key={p.id} serviceId={service.id} photo={p} onChanged={invalidate} />
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Pipeline results (v3.1 §5.3) are advisory — the system flags, you decide. “Not yet scanned”
          means the listing predates the scan or it is still queued.
        </p>
      </Section>

      {/* ── Owner ── */}
      <Section title="Owner" icon={ShieldCheck}>
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <Avatar name={service.provider.name} src={service.provider.avatar_url} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate font-medium text-slate-800 dark:text-slate-200">{service.provider.name}</p>
              <StatusPill label={`T${service.provider.trust_tier}`} variant={service.provider.trust_tier >= 3 ? 'verified' : 'neutral'} />
              <StatusPill label={service.provider.account_state} autoVariant />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {service.provider.rating !== null ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3 fill-amber-400 text-amber-400" /> {service.provider.rating.toFixed(2)} ({service.provider.reviews_count})
                </span>
              ) : (
                <span>No reviews</span>
              )}
              {service.provider.open_reports > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3" /> {service.provider.open_reports} open report{service.provider.open_reports === 1 ? '' : 's'}
                </span>
              )}
            </p>
            <Link
              href={`/users?user=${service.provider.id}`}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Open provider record (standing, prior actions) <ExternalLink className="size-3" />
            </Link>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Repeated or severe violations are handled at the provider level in the Users module
          (suspend / ban) — not duplicated here.
        </p>
      </Section>

      {/* ── Category + §8.1 commission band ── */}
      <Section title="Category & commission band (§8.1)" icon={Tag}>
        {service.category ? (
          <div className={cn(
            'flex items-center justify-between gap-3 rounded-lg border p-3',
            service.category.band_valid
              ? 'border-slate-200 dark:border-slate-700'
              : 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10',
          )}>
            <div className="min-w-0">
              <Link
                href={`/categories?category=${service.category.id}`}
                className="inline-flex items-center gap-1 font-medium text-slate-800 hover:text-teal-600 hover:underline dark:text-slate-200 dark:hover:text-teal-400"
              >
                {service.category.name} <ExternalLink className="size-3" />
              </Link>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Band: {bandLabel(service.category.commission_band)}
              </p>
            </div>
            {service.category.band_valid ? (
              <StatusPill label="Valid band" variant="active" />
            ) : (
              <StatusPill label="No valid band" variant="warning" />
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/10 dark:text-amber-400">
            This listing has no category — it cannot be priced for commission. Reassign it to a banded
            category below.
          </div>
        )}
      </Section>

      {/* ── Moderation ── */}
      <Section title="Moderation" icon={ShieldCheck}>
        <ServiceModerationActions service={service} onChanged={invalidate} />
      </Section>

      {/* ── Audit trail (scoped to this service) ── */}
      <Section title="Audit trail" icon={ScrollText}>
        <AuditTrail targetType="service" targetId={service.id} />
      </Section>
    </div>
  )
}

// ── Flag list ───────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<ServiceFlag['source'], string> = {
  pipeline: 'Image pipeline',
  flag: 'Report / queue',
  policy: 'Policy',
  catalogue: 'Catalogue',
}

function FlagList({ flags }: { flags: ServiceFlag[] }) {
  const hasContact = flags.some((f) => f.reason === 'CONTACT_IN_LISTING')
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {flags.map((f, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-900/10"
          >
            {f.reason === 'CONTACT_IN_LISTING' ? (
              <Phone className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                {flagLabel(f.reason)}
                <span className="ml-1.5 text-[11px] font-normal text-amber-600/80 dark:text-amber-400/70">
                  {SOURCE_LABEL[f.source]}
                </span>
              </p>
              {f.detail && <p className="text-xs text-amber-700/90 dark:text-amber-300/80">{f.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
      {hasContact && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          DIRECT mode: paying the provider directly is the model — this flag is about publishing
          contact details in the public listing to bypass the recorded booking flow (§10.3), not the
          act of paying directly.
        </p>
      )}
    </div>
  )
}

// ── Photo card (read-only pipeline verdict + flagged-photo removal) ──────────

function PhotoCard({
  serviceId,
  photo,
  onChanged,
}: {
  serviceId: string
  photo: ServicePhotoResult
  onChanged: () => void
}) {
  const [broken, setBroken] = useState(false)

  const remove = useAuditedMutation<{ photoId: number }, ServiceDetailType>({
    capability: 'services.moderate',
    audit: {
      action: 'Remove photo',
      targetType: 'service',
      targetId: serviceId,
      summary: 'Remove this photo from the listing. Use this for a specific photo the pipeline flagged.',
    },
    mutationFn: (p) => servicesApi.removePhoto(serviceId, p.photoId, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const flagged = photo.issues.length > 0

  return (
    <div className={cn(
      'overflow-hidden rounded-lg border',
      flagged ? 'border-amber-300 dark:border-amber-700' : 'border-slate-200 dark:border-slate-700',
    )}>
      <div className="relative aspect-square bg-slate-100 dark:bg-slate-800">
        {broken ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400">
            <ImgIcon className="size-6" aria-hidden="true" />
            <span className="text-[10px]">Image unavailable</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only listing photo, domain not configured for next/image
          <img
            src={photoUrl(photo.path)}
            alt={`Listing photo ${photo.id}${flagged ? ` — flagged: ${photo.issues.join(', ')}` : ''}`}
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        )}
      </div>

      {/* Pipeline verdict — text, not colour alone */}
      <div className="space-y-1 p-2">
        <PipelineVerdict photo={photo} />
        {flagged && (
          <Can do="services.moderate">
            <button
              type="button"
              onClick={() => remove.trigger({ photoId: photo.id })}
              disabled={remove.isPending}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50 dark:text-red-400"
            >
              <Trash2 className="size-3" /> Remove photo
            </button>
          </Can>
        )}
      </div>
    </div>
  )
}

function PipelineVerdict({ photo }: { photo: ServicePhotoResult }) {
  if (photo.pipeline_status === 'PENDING' && photo.issues.length === 0) {
    return <p className="text-[11px] text-slate-400">Not yet scanned</p>
  }
  if (photo.issues.length === 0) {
    return <p className="text-[11px] text-teal-600 dark:text-teal-400">Pipeline: clean</p>
  }
  return (
    <ul className="space-y-0.5">
      {photo.issues.includes('NSFW') && (
        <li className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          NSFW {photo.nsfw_score !== null && <>({photo.nsfw_score.toFixed(2)})</>}
        </li>
      )}
      {photo.issues.includes('DUPLICATE') && (
        <li className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Duplicate match</li>
      )}
      {photo.issues.includes('EXIF') && (
        <li className="text-[11px] font-medium text-amber-700 dark:text-amber-400">EXIF not stripped</li>
      )}
    </ul>
  )
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <Icon className="size-3.5" />
        <span>{title}</span>
      </h4>
      {children}
    </section>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  )
}
