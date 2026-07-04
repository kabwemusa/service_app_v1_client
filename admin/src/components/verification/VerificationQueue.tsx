'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoCheckmarkCircleOutline, IoWarningOutline, IoTimeOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { DetailPanel } from '@/components/ui/DetailPanel'
import { StatusPill } from '@/components/ui/StatusPill'
import { Avatar } from '@/components/ui/Avatar'
import { useAuthStore } from '@/lib/store/auth-store'
import { useAdminChannel } from '@/lib/realtime/useAdminChannel'
import { useQueueBadgeStore } from '@/lib/realtime/queue-badge-store'
import { cn, fmtRelative } from '@/lib/utils'
import {
  verificationApi,
  slaInfo,
  SUBMISSION_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  type VerificationSubmission,
  type VerificationStatus,
  type SubmissionType,
} from '@/lib/api/verification'
import { VerificationDetail } from '@/components/verification/VerificationDetail'

const TYPE_OPTIONS = (Object.keys(SUBMISSION_TYPE_LABEL) as SubmissionType[]).map((v) => ({
  value: v,
  label: SUBMISSION_TYPE_LABEL[v],
}))

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as VerificationStatus[]).map((v) => ({
  value: v,
  label: STATUS_LABEL[v],
}))

const SLA_OPTIONS = [
  { value: 'breached', label: 'SLA breached' },
  { value: 'due_soon', label: 'Due within 6h' },
]

function SlaCell({ submission }: { submission: VerificationSubmission }) {
  const sla = slaInfo(submission.sla_due_at)
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-slate-600 dark:text-slate-400">{fmtRelative(submission.submitted_at)}</span>
      {sla && (
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium',
            sla.breached
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
              : sla.dueSoon
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400'
                : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800',
          )}
        >
          {sla.breached ? <IoWarningOutline className="size-2.5" /> : <IoTimeOutline className="size-2.5" />}
          {sla.label}
        </span>
      )}
    </div>
  )
}

export function VerificationQueue() {
  const currentUserId = useAuthStore((s) => s.user?.id)
  const queryClient = useQueryClient()
  const bumpBadge = useQueueBadgeStore((s) => s.increment)

  useAdminChannel('verification', {
    'verification.submitted': () => {
      queryClient.invalidateQueries({ queryKey: ['verifications'] })
      bumpBadge('verification')
    },
  })

  // Filters + pagination
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [type, setType] = useState<SubmissionType | ''>('')
  const [status, setStatus] = useState<VerificationStatus | ''>('')
  const [sla, setSla] = useState<'breached' | 'due_soon' | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const params = { page, search, type, status, sla, sort: 'oldest' as const }

  const { data, isLoading } = useQuery({
    queryKey: ['verifications', params],
    queryFn: () => verificationApi.list(params),
  })

  // Detail is fetched fresh so the drawer always reflects the latest claim /
  // decision state (the list row is a summary).
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['verification', selectedId],
    queryFn: () => verificationApi.detail(selectedId!),
    enabled: !!selectedId,
  })

  const selectedRow = data?.data.find((s) => s.id === selectedId)

  const columns = useMemo<ColumnDef<VerificationSubmission>[]>(
    () => [
      {
        id: 'applicant',
        header: 'Applicant',
        enableSorting: false,
        cell: ({ row }) => {
          const s = row.original
          return (
            <div className="flex items-center gap-2.5">
              {/* Initials only — never the KYC selfie */}
              <Avatar name={s.applicant.display_name} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800 dark:text-slate-200">
                  {s.applicant.display_name}
                </p>
                <p className="text-xs text-slate-400">Tier {s.applicant.current_tier}</p>
              </div>
            </div>
          )
        },
      },
      {
        id: 'type',
        header: 'Type',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600 dark:text-slate-400">
            {SUBMISSION_TYPE_LABEL[row.original.type]}
          </span>
        ),
      },
      {
        id: 'submitted',
        header: 'Submitted · SLA',
        enableSorting: false,
        cell: ({ row }) => <SlaCell submission={row.original} />,
      },
      {
        id: 'auto',
        header: 'Automated checks',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-xs text-xs text-slate-500 dark:text-slate-400">
            {row.original.auto_summary || '—'}
          </span>
        ),
      },
      {
        id: 'assignment',
        header: 'Assignment',
        enableSorting: false,
        cell: ({ row }) => {
          const claimed = row.original.claimed_by
          return claimed ? (
            <span className="text-xs text-slate-600 dark:text-slate-400">
              In review · {claimed.name}
            </span>
          ) : (
            <span className="text-xs text-slate-400">Unassigned</span>
          )
        },
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        cell: ({ row }) => (
          <StatusPill
            label={STATUS_LABEL[row.original.status]}
            variant={STATUS_VARIANT[row.original.status]}
          />
        ),
      },
      {
        id: 'action',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setSelectedId(row.original.id)}
            className="rounded-sm border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label={`Review ${row.original.applicant.display_name}'s ${SUBMISSION_TYPE_LABEL[row.original.type]} submission`}
          >
            Review
          </button>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
          <IoCheckmarkCircleOutline className="size-5 text-teal-600" />
          Verification queue
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Identity, address, professional-tier and certification submissions. Oldest pending first.
        </p>
      </div>

      <FilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="Search by applicant…"
        filters={[
          {
            key: 'type',
            label: 'All types',
            value: type,
            options: TYPE_OPTIONS,
            onChange: (v) => {
              setType(v as SubmissionType | '')
              setPage(1)
            },
          },
          {
            key: 'status',
            label: 'All statuses',
            value: status,
            options: STATUS_OPTIONS,
            onChange: (v) => {
              setStatus(v as VerificationStatus | '')
              setPage(1)
            },
          },
          {
            key: 'sla',
            label: 'Any SLA',
            value: sla,
            options: SLA_OPTIONS,
            onChange: (v) => {
              setSla(v as 'breached' | 'due_soon' | '')
              setPage(1)
            },
          },
        ]}
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No verifications pending"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      <DetailPanel
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        width="xl"
        title={
          selectedRow
            ? `${selectedRow.applicant.display_name} · ${SUBMISSION_TYPE_LABEL[selectedRow.type]}`
            : 'Verification review'
        }
        subtitle={selectedRow ? STATUS_LABEL[selectedRow.status] : undefined}
      >
        {detail ? (
          <VerificationDetail
            detail={detail}
            currentUserId={currentUserId}
            isLoading={detailLoading}
          />
        ) : (
          <VerificationDetailSkeleton />
        )}
      </DetailPanel>
    </div>
  )
}

function VerificationDetailSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-sm bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  )
}
