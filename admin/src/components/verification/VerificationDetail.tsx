'use client'

import { useQueryClient, useMutation } from '@tanstack/react-query'
import {
  IoShieldCheckmarkOutline,
  IoBanOutline,
  IoHelpCircleOutline,
  IoPersonAddOutline,
  IoLockClosedOutline,
  IoRibbonOutline,
  IoTimeOutline,
} from 'react-icons/io5'
import { Avatar } from '@/components/ui/Avatar'
import { StatusPill } from '@/components/ui/StatusPill'
import { AuditTrail } from '@/components/ui/AuditTrail'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { toast } from '@/lib/store/toast-store'
import { fmtDatetime, fmtRelative, cn } from '@/lib/utils'
import {
  verificationApi,
  SUBMISSION_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  GRANTED_TIER,
  isResolved,
  type VerificationDetail as Detail,
} from '@/lib/api/verification'
import { ArtifactViewer } from '@/components/verification/ArtifactViewer'
import { AutomatedChecks } from '@/components/verification/AutomatedChecks'
import { Tier4Prerequisites } from '@/components/verification/Tier4Prerequisites'
import { VerificationTimeline } from '@/components/verification/VerificationTimeline'

const AUDIT_TARGET_TYPE = 'verification_submission'

// Empty decision payload — the audited-mutation wrapper appends { reason }.
// No artifact data ever enters this payload.
type DecisionPayload = Record<string, never>

interface Props {
  detail: Detail
  currentUserId: string | undefined
  isLoading?: boolean
}

export function VerificationDetail({ detail, currentUserId, isLoading }: Props) {
  const queryClient = useQueryClient()
  const { applicant } = detail
  const resolved = isResolved(detail.status)
  const grantedTier = GRANTED_TIER[detail.type]
  const typeLabel = SUBMISSION_TYPE_LABEL[detail.type]

  const claimedByMe = !!detail.claimed_by && detail.claimed_by.id === currentUserId
  const claimedByOther = !!detail.claimed_by && detail.claimed_by.id !== currentUserId
  // Concurrency guard: only the claiming reviewer may act, and only while open.
  const canAct = !resolved && claimedByMe

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['verifications'] })
    queryClient.invalidateQueries({ queryKey: ['verification', detail.id] })
  }

  // ── Claim / assignment (not a state decision → no reason required) ──────
  const claimMutation = useMutation({
    mutationFn: () => verificationApi.claim(detail.id),
    onSuccess: () => {
      toast.success('Submission claimed. You are now reviewing it.')
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not claim submission.'),
  })

  // ── Decisions — all via the audited-mutation wrapper ────────────────────
  const approve = useAuditedMutation<DecisionPayload, Detail>({
    capability: 'write:verification',
    audit: {
      action: 'verification.approve',
      targetType: AUDIT_TARGET_TYPE,
      targetId: detail.id,
      summary: grantedTier
        ? `Approve ${typeLabel} for ${applicant.display_name}. This grants Tier ${grantedTier} and transitions their KYC state. The reason is recorded in the audit log.`
        : `Approve and attach this certification to ${applicant.display_name}'s profile. The reason is recorded in the audit log.`,
    },
    mutationFn: (p) => verificationApi.approve(detail.id, { reason: p.reason }),
    onSuccess: invalidate,
  })

  const reject = useAuditedMutation<DecisionPayload, Detail>({
    capability: 'write:verification',
    audit: {
      action: 'verification.reject',
      targetType: AUDIT_TARGET_TYPE,
      targetId: detail.id,
      summary: `Reject ${typeLabel} for ${applicant.display_name}. This blocks the tier and the reason is shown to the applicant, who may resubmit.`,
    },
    mutationFn: (p) => verificationApi.reject(detail.id, { reason: p.reason }),
    onSuccess: invalidate,
  })

  const requestInfo = useAuditedMutation<DecisionPayload, Detail>({
    capability: 'write:verification',
    audit: {
      action: 'verification.request_info',
      targetType: AUDIT_TARGET_TYPE,
      targetId: detail.id,
      summary: `Request more information from ${applicant.display_name}. The note you enter is shown to the applicant and the item moves to "needs info".`,
    },
    mutationFn: (p) => verificationApi.requestInfo(detail.id, { reason: p.reason }),
    onSuccess: invalidate,
  })

  const anyPending = approve.isPending || reject.isPending || requestInfo.isPending

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-sm bg-slate-100 dark:bg-slate-800" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Applicant summary ──────────────────────────────────────────── */}
      <section className="flex items-start gap-3">
        {/* Initials avatar — NEVER the KYC selfie */}
        <Avatar name={applicant.display_name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-medium text-slate-900 dark:text-slate-100">
              {applicant.display_name}
            </h3>
            <StatusPill
              label={STATUS_LABEL[detail.status]}
              variant={STATUS_VARIANT[detail.status]}
            />
          </div>
          {applicant.legal_name && applicant.legal_name !== applicant.display_name && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Legal name: {applicant.legal_name}{' '}
              <span className="text-slate-400">(reviewer-only)</span>
            </p>
          )}
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">Current tier</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-300">
                Tier {applicant.current_tier}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">Account</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-300">
                {applicant.account_state}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">Prior reviews</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-300">
                {applicant.prior_reviews}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">Prior rejections</dt>
              <dd
                className={cn(
                  'font-medium',
                  applicant.prior_rejections > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-700 dark:text-slate-300',
                )}
              >
                {applicant.prior_rejections}
              </dd>
            </div>
            {applicant.trust_score !== undefined && (
              <div className="col-span-2 flex justify-between gap-2 border-t border-slate-100 pt-1 dark:border-slate-800">
                <dt className="text-slate-400">Trust score (internal)</dt>
                <dd className="font-medium tabular-nums text-slate-700 dark:text-slate-300">
                  {applicant.trust_score.toFixed(2)}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      {/* Submission meta */}
      <div className="flex items-center gap-2 rounded-sm bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        <IoRibbonOutline className="size-3.5 shrink-0 text-slate-400" />
        <span>{typeLabel}</span>
        <span aria-hidden="true">·</span>
        <IoTimeOutline className="size-3.5 shrink-0 text-slate-400" />
        <span>Submitted {fmtRelative(detail.submitted_at)}</span>
      </div>

      {/* ── Progression timeline ───────────────────────────────────────── */}
      <VerificationTimeline events={detail.timeline ?? []} />

      {/* ── Resolved banner (read-only) ────────────────────────────────── */}
      {resolved && detail.decision && (
        <div
          className={cn(
            'rounded-sm border px-4 py-3 text-sm',
            detail.decision.outcome === 'approved'
              ? 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
          )}
        >
          <p className="font-medium">
            {detail.decision.outcome === 'approved' ? 'Approved' : 'Rejected'} by{' '}
            {detail.decision.decided_by} · {fmtDatetime(detail.decision.decided_at)}
          </p>
          <p className="mt-1 text-xs opacity-90">Reason: {detail.decision.reason}</p>
        </div>
      )}

      {/* ── Submitted artifacts (reviewer-only) ────────────────────────── */}
      <ArtifactViewer artifacts={detail.artifacts} />

      {/* ── Certification metadata (§5.2) ──────────────────────────────── */}
      {detail.certification && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Certification details
          </h3>
          <dl className="rounded-sm border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <div className="flex justify-between gap-2 py-1">
              <dt className="text-slate-400">Title</dt>
              <dd className="text-slate-700 dark:text-slate-300">{detail.certification.title}</dd>
            </div>
            <div className="flex justify-between gap-2 py-1">
              <dt className="text-slate-400">Issuer</dt>
              <dd className="text-slate-700 dark:text-slate-300">{detail.certification.issuer}</dd>
            </div>
            <div className="flex justify-between gap-2 py-1">
              <dt className="text-slate-400">Type</dt>
              <dd className="text-slate-700 dark:text-slate-300">
                {detail.certification.cert_type.replace('_', ' ')}
              </dd>
            </div>
            {detail.certification.issued_on && (
              <div className="flex justify-between gap-2 py-1">
                <dt className="text-slate-400">Issued</dt>
                <dd className="text-slate-700 dark:text-slate-300">{detail.certification.issued_on}</dd>
              </div>
            )}
            {detail.certification.expires_on && (
              <div className="flex justify-between gap-2 py-1">
                <dt className="text-slate-400">Expires</dt>
                <dd className="text-slate-700 dark:text-slate-300">{detail.certification.expires_on}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* ── Tier 4 prerequisite gate (§4.5) ────────────────────────────── */}
      {detail.tier4 && <Tier4Prerequisites prereqs={detail.tier4} />}

      {/* ── Automated checks (advisory, read-only) ─────────────────────── */}
      <AutomatedChecks checks={detail.automated} />

      {/* ── Audit trail for this submission ────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Audit trail
        </h3>
        <AuditTrail targetType={AUDIT_TARGET_TYPE} targetId={detail.id} />
      </section>

      {/* ── Decision actions ───────────────────────────────────────────── */}
      <Can
        do="write:verification"
        fallback={
          <p className="rounded-sm border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400 dark:border-slate-700">
            <IoLockClosedOutline className="mr-1 inline size-3" />
            You have read-only access to verifications.
          </p>
        }
      >
        <div className="sticky bottom-0 -mx-5 border-t border-slate-200 bg-white px-5 pt-4 dark:border-slate-700 dark:bg-slate-900">
          {resolved ? (
            <p className="pb-1 text-center text-xs text-slate-400">
              This submission is resolved and read-only. See the audit trail above for the decision.
            </p>
          ) : claimedByOther ? (
            <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
              In review by {detail.claimed_by!.name}. Another reviewer is handling this item.
            </p>
          ) : !claimedByMe ? (
            <button
              type="button"
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-teal-600 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
            >
              <IoPersonAddOutline className="size-4" />
              {claimMutation.isPending ? 'Claiming…' : 'Claim to review'}
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => approve.trigger({})}
                disabled={!canAct || anyPending}
                aria-label={`Approve ${typeLabel} for ${applicant.display_name}`}
                className="flex h-11 items-center justify-center gap-1.5 rounded-sm bg-teal-600 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                <IoShieldCheckmarkOutline className="size-4" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => requestInfo.trigger({})}
                disabled={!canAct || anyPending}
                aria-label={`Request more information from ${applicant.display_name}`}
                className="flex h-11 items-center justify-center gap-1.5 rounded-sm border border-amber-300 bg-amber-50 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
              >
                <IoHelpCircleOutline className="size-4" />
                More info
              </button>
              <button
                type="button"
                onClick={() => reject.trigger({})}
                disabled={!canAct || anyPending}
                aria-label={`Reject ${typeLabel} for ${applicant.display_name}`}
                className="flex h-11 items-center justify-center gap-1.5 rounded-sm border border-red-300 bg-red-50 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400"
              >
                <IoBanOutline className="size-4" />
                Reject
              </button>
            </div>
          )}
          <p className="pt-2 pb-1 text-center text-[11px] text-slate-400">
            Every decision is recorded in the audit log with your reason.
          </p>
        </div>
      </Can>
    </div>
  )
}
