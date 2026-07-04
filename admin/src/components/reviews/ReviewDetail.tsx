'use client'

import { type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IoStarOutline, IoShieldCheckmarkOutline, IoOpenOutline, IoWarningOutline, IoChatbubbleOutline,
  IoCalendarOutline, IoDocumentTextOutline, IoFlagOutline, IoShieldHalfOutline,
} from 'react-icons/io5'
import { Avatar } from '@/components/ui/Avatar'
import { StatusPill } from '@/components/ui/StatusPill'
import { AuditTrail } from '@/components/ui/AuditTrail'
import { cn, fmtDate } from '@/lib/utils'
import {
  reviewsApi,
  STATUS_LABEL,
  STATUS_VARIANT,
  flagLabel,
  FRAUD_REASONS,
  type ReviewDetail as ReviewDetailType,
  type ReviewFlag,
} from '@/lib/api/reviews'
import { Stars } from '@/components/reviews/ReviewsManager'
import { ReviewModerationActions } from '@/components/reviews/ReviewModerationActions'

interface Props {
  reviewId: string
}

const SOURCE_LABEL: Record<ReviewFlag['source'], string> = {
  report: 'User report',
  auto: 'Auto-detected',
  pattern: 'Pattern',
  flag: 'Report / queue',
}

export function ReviewDetail({ reviewId }: Props) {
  const qc = useQueryClient()

  const { data: review, isLoading } = useQuery({
    queryKey: ['review', reviewId],
    queryFn: () => reviewsApi.detail(reviewId),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['review', reviewId] })
    qc.invalidateQueries({ queryKey: ['reviews'] })
  }

  if (isLoading || !review) return <DetailSkeleton />

  const removed = review.status === 'REMOVED'
  const fraudFlag = review.flags.some((f) => FRAUD_REASONS.has(f.reason))

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <Stars rating={review.rating} />
          <StatusPill label={STATUS_LABEL[review.status]} variant={STATUS_VARIANT[review.status]} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>Left {fmtDate(review.created_at)}</span>
          {review.verified_booking && (
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-1.5 py-px font-medium text-teal-700 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-400">
              <IoShieldCheckmarkOutline className="size-3" aria-hidden="true" /> Verified booking (§12)
            </span>
          )}
        </p>
      </div>

      {/* ── Removed banner (read-only with reason + audit) ── */}
      {removed && (
        <div className="rounded-sm border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/20">
          <p className="font-medium text-red-700 dark:text-red-400">
            Review removed{review.removed_at && <> · {fmtDate(review.removed_at)}</>}
          </p>
          {review.moderation_reason && (
            <p className="mt-1 text-red-600/90 dark:text-red-300/90">
              <span className="font-medium">Reason:</span> {review.moderation_reason}
            </p>
          )}
          <p className="mt-1 text-xs text-red-600/70 dark:text-red-300/70">
            It no longer counts toward the provider’s rating. Full history is in the audit trail below.
          </p>
        </div>
      )}

      {/* ── Flags ── */}
      {review.flags.length > 0 && (
        <Section title="Flags" icon={IoWarningOutline}>
          <FlagList flags={review.flags} />
          {fraudFlag && (
            <Link
              href={`/fraud?user=${review.provider.id ?? ''}`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              <IoShieldHalfOutline className="size-3.5" /> Possible coordinated manipulation — open in Fraud <IoOpenOutline className="size-3" />
            </Link>
          )}
        </Section>
      )}

      {/* ── Review text ── */}
      <Section title="Review" icon={IoChatbubbleOutline}>
        {review.comment ? (
          <p className="whitespace-pre-wrap rounded-sm border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
            {review.comment}
          </p>
        ) : (
          <p className="text-sm text-slate-400">No written comment — rating only.</p>
        )}
      </Section>

      {/* ── Booking / service context ── */}
      <Section title="Booking & service" icon={IoCalendarOutline}>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <ContextTile label="Service" value={review.service?.title ?? '—'} href={review.service ? `/services?service=${review.service.id}` : undefined} />
          <ContextTile label="Booking status" value={review.booking?.status ?? '—'} />
        </div>
      </Section>

      {/* ── Parties (link out to Users) ── */}
      <Section title="Parties" icon={IoShieldCheckmarkOutline}>
        <div className="space-y-2">
          <PartyRow role="Reviewer" id={review.reviewer.id} name={review.reviewer.name} />
          <PartyRow
            role="Provider reviewed"
            id={review.provider.id}
            name={review.provider.name}
            avatar={review.provider.avatar_url}
            tier={review.provider.trust_tier}
            accountState={review.provider.account_state}
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Severe or repeat offenders are handled at the account level in the Users module — not here.
        </p>
      </Section>

      {/* ── Provider's current rating (§7.1) ── */}
      <Section title="Provider rating (§7.1)" icon={IoStarOutline}>
        <div className="grid grid-cols-3 gap-2">
          <RatingTile label="Bayesian" value={review.provider_rating.r_bayes !== null ? review.provider_rating.r_bayes.toFixed(2) : '—'} primary />
          <RatingTile label="Raw average" value={review.provider_rating.r_raw !== null ? review.provider_rating.r_raw.toFixed(2) : '—'} />
          <RatingTile label="Reviews" value={String(review.provider_rating.reviews_count)} />
        </div>
        {!removed && (
          <p className="mt-2 text-[11px] text-slate-400">
            Removing this review recomputes the Bayesian rating (§7.1) for the provider.
          </p>
        )}
      </Section>

      {/* ── Provider response (moderated separately) ── */}
      {review.response && (
        <Section title="Provider response" icon={IoChatbubbleOutline}>
          <div className="rounded-sm border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <p className="text-sm text-slate-700 dark:text-slate-300">{review.response.text}</p>
            {review.response.responded_at && (
              <p className="mt-1 text-xs text-slate-400">Replied {fmtDate(review.response.responded_at)}</p>
            )}
          </div>
        </Section>
      )}

      {/* ── Moderation ── */}
      <Section title="Moderation" icon={IoFlagOutline}>
        <ReviewModerationActions review={review} onChanged={invalidate} />
      </Section>

      {/* ── Audit trail (scoped to this review) ── */}
      <Section title="Audit trail" icon={IoDocumentTextOutline}>
        <AuditTrail targetType="review" targetId={review.id} />
      </Section>
    </div>
  )
}

// ── Flag list ───────────────────────────────────────────────────────────────

function FlagList({ flags }: { flags: ReviewFlag[] }) {
  return (
    <ul className="space-y-1.5">
      {flags.map((f, i) => (
        <li
          key={i}
          className="flex items-start gap-2 rounded-sm border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-900/10"
        >
          <IoWarningOutline className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              {flagLabel(f.reason)}
              <span className="ml-1.5 text-[11px] font-normal text-amber-600/80 dark:text-amber-400/70">{SOURCE_LABEL[f.source]}</span>
            </p>
            {f.detail && <p className="text-xs text-amber-700/90 dark:text-amber-300/80">{f.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── Small pieces ────────────────────────────────────────────────────────────

function PartyRow({
  role,
  id,
  name,
  avatar,
  tier,
  accountState,
}: {
  role: string
  id: string | null
  name: string
  avatar?: string | null
  tier?: number
  accountState?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-sm border border-slate-200 p-2.5 dark:border-slate-700">
      <Avatar name={name} src={avatar} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{role}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{name}</span>
          {tier !== undefined && <StatusPill label={`T${tier}`} variant={tier >= 3 ? 'verified' : 'neutral'} />}
          {accountState && accountState !== 'ACTIVE' && <StatusPill label={accountState} autoVariant />}
        </div>
      </div>
      {id && (
        <Link
          href={`/users?user=${id}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
        >
          Open <IoOpenOutline className="size-3" />
        </Link>
      )}
    </div>
  )
}

function ContextTile({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <div className={cn('rounded-sm border border-slate-200 px-3 py-2 dark:border-slate-700', href && 'hover:bg-slate-50 dark:hover:bg-slate-700/40')}>
      <p className="flex items-center gap-1 text-[11px] text-slate-400">
        {label}
        {href && <IoOpenOutline className="ml-auto size-2.5" />}
      </p>
      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

function RatingTile({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className={cn('rounded-sm border px-3 py-2', primary ? 'border-teal-200 bg-teal-50/50 dark:border-teal-800 dark:bg-teal-900/10' : 'border-slate-200 dark:border-slate-700')}>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={cn('text-base font-semibold', primary ? 'text-teal-700 dark:text-teal-400' : 'text-slate-800 dark:text-slate-200')}>{value}</p>
    </div>
  )
}

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
        <div className="h-5 w-1/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-1/4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-sm bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  )
}
