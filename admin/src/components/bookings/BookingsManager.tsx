'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoCalendarOutline, IoWarningOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { DetailPanel } from '@/components/ui/DetailPanel'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/Card'
import { useCan } from '@/lib/rbac/use-can'
import { fmtZMW, fmtDate, fmtDatetime } from '@/lib/utils'
import { bookingsApi, type BookingRow, type BookingDetail } from '@/lib/api/bookings'

const STATUS_OPTIONS = [
  'PENDING_PAYMENT', 'REQUESTED', 'AWAITING_KYC', 'FUNDS_HELD', 'IN_PROGRESS',
  'DELIVERED', 'COMPLETED', 'DISPUTED', 'CHARGEBACK_PENDING', 'DISBURSED', 'CANCELLED',
].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }))

const PAYMENT_MODE_OPTIONS = [
  { value: 'DIRECT', label: 'Direct' },
  { value: 'ESCROW', label: 'Escrow' },
]

export function BookingsManager() {
  const canView = useCan('read:bookings')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [paymentMode, setPaymentMode] = useState('')
  const [disputedOnly, setDisputedOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-bookings', page, search, status, paymentMode, disputedOnly],
    queryFn: () => bookingsApi.list({
      page, search, status, payment_mode: paymentMode, disputed: disputedOnly ? '1' : '',
    }),
    enabled: canView,
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-booking', selectedId],
    queryFn: () => bookingsApi.detail(selectedId!),
    enabled: !!selectedId,
  })

  const selectedRow = data?.data.find((b) => b.id === selectedId)

  const columns = useMemo<ColumnDef<BookingRow>[]>(() => [
    { accessorKey: 'id', header: 'Booking', cell: ({ row }) => (
      <span className="font-mono text-xs text-slate-500">{row.original.id.slice(0, 8)}…</span>
    ) },
    { accessorKey: 'service_title', header: 'Service' },
    { accessorKey: 'buyer_name', header: 'Customer' },
    { accessorKey: 'provider_name', header: 'Provider' },
    { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => fmtZMW(row.original.amount) },
    { accessorKey: 'payment_mode', header: 'Mode', cell: ({ row }) => <span className="capitalize">{row.original.payment_mode.toLowerCase()}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <StatusPill label={row.original.status.replace(/_/g, ' ')} autoVariant />
        {row.original.disputed && <IoWarningOutline className="size-3.5 text-amber-500" aria-label="Disputed" />}
      </div>
    ) },
    { accessorKey: 'created_at', header: 'Created', cell: ({ row }) => fmtDate(row.original.created_at) },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setSelectedId(row.original.id)}
          className="rounded-sm border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          View
        </button>
      ),
    },
  ], [])

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Bookings</h1>
        <EmptyState title="Access denied" description="You do not have permission to view bookings." icon={IoCalendarOutline} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
          <IoCalendarOutline className="size-5 text-teal-600" />
          Bookings
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Escrow state, payment status, and dispute history for every booking.
        </p>
      </div>

      <FilterBar
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search by customer, provider, service…"
        filters={[
          { key: 'status', label: 'All statuses', value: status, options: STATUS_OPTIONS, onChange: (v) => { setStatus(v); setPage(1) } },
          { key: 'payment_mode', label: 'All modes', value: paymentMode, options: PAYMENT_MODE_OPTIONS, onChange: (v) => { setPaymentMode(v); setPage(1) } },
        ]}
        actions={
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={disputedOnly} onChange={(e) => { setDisputedOnly(e.target.checked); setPage(1) }} />
            Disputed only
          </label>
        }
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No bookings for this filter"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      <DetailPanel
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        width="lg"
        title={selectedRow ? `${selectedRow.service_title}` : 'Booking detail'}
        subtitle={selectedRow ? `${selectedRow.buyer_name} · ${selectedRow.provider_name}` : undefined}
      >
        {detail && !detailLoading ? <BookingDetailPanel detail={detail} /> : <DetailSkeleton />}
      </DetailPanel>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-sm bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  )
}

function BookingDetailPanel({ detail }: { detail: BookingDetail }) {
  const timelineEntries = Object.entries(detail.timeline).filter(([, v]) => v !== null) as Array<[string, string]>

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <StatusPill label={detail.status.replace(/_/g, ' ')} autoVariant />
          <span className="text-lg font-medium text-slate-900 dark:text-slate-100">{fmtZMW(detail.amount)}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Payment mode</dt><dd className="font-medium text-slate-700 dark:text-slate-300">{detail.payment_mode}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Payment status</dt><dd className="font-medium text-slate-700 dark:text-slate-300">{detail.payment_status ?? '—'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Buyer protection fee</dt><dd className="font-medium text-slate-700 dark:text-slate-300">{fmtZMW(detail.buyer_protection_fee)}</dd></div>
          {detail.quoted_amount !== null && (
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Quoted amount</dt><dd className="font-medium text-slate-700 dark:text-slate-300">{fmtZMW(detail.quoted_amount)}</dd></div>
          )}
        </dl>
      </Card>

      <Card>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Parties</h3>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Customer</dt><dd className="text-slate-700 dark:text-slate-300">{detail.buyer?.name ?? '—'} {detail.buyer?.phone_masked && <span className="text-xs text-slate-400">({detail.buyer.phone_masked})</span>}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Provider</dt><dd className="text-slate-700 dark:text-slate-300">{detail.provider?.name ?? '—'} {detail.provider?.momo_masked && <span className="text-xs text-slate-400">({detail.provider.momo_masked})</span>}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Service</dt><dd className="text-slate-700 dark:text-slate-300">{detail.service?.title ?? '—'} <span className="text-xs text-slate-400">{detail.service?.category_name}</span></dd></div>
          {detail.delivery_location_label && (
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Location</dt><dd className="text-slate-700 dark:text-slate-300">{detail.delivery_location_label}</dd></div>
          )}
        </dl>
      </Card>

      <Card>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Timeline</h3>
        {timelineEntries.length === 0 ? (
          <p className="text-xs text-slate-400">No timestamps recorded yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {timelineEntries.map(([key, value]) => (
              <li key={key} className="flex justify-between gap-2">
                <span className="text-slate-400 capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="text-slate-600 dark:text-slate-400">{fmtDatetime(value)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail.commission && (
        <Card>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Commission</h3>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Gross</dt><dd className="text-slate-700 dark:text-slate-300">{fmtZMW(detail.commission.gross_amount)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Commission</dt><dd className="text-slate-700 dark:text-slate-300">{fmtZMW(detail.commission.commission_amount)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Net to provider</dt><dd className="text-slate-700 dark:text-slate-300">{fmtZMW(detail.commission.net_to_provider)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Collection status</dt><dd><StatusPill label={detail.commission.collection_status} autoVariant /></dd></div>
          </dl>
        </Card>
      )}

      {detail.dispute && (
        <Card className="border-amber-200 dark:border-amber-800">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
            <IoWarningOutline className="size-3.5" /> Dispute
          </h3>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Status</dt><dd><StatusPill label={detail.dispute.status} autoVariant /></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Reason</dt><dd className="text-slate-700 dark:text-slate-300">{detail.dispute.reason_category}</dd></div>
            {detail.dispute.refund_amount !== null && (
              <div className="flex justify-between gap-2"><dt className="text-slate-400">Refund amount</dt><dd className="text-slate-700 dark:text-slate-300">{fmtZMW(detail.dispute.refund_amount)}</dd></div>
            )}
          </dl>
        </Card>
      )}

      {detail.escrow_events.length > 0 && (
        <Card>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Escrow / PawaPay events</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {detail.escrow_events.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-xs">
                <div>
                  <span className="font-medium capitalize text-slate-700 dark:text-slate-300">{e.type}</span>
                  <span className="ml-1.5 text-slate-400">{e.mno ?? ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill label={e.pawapay_status} autoVariant />
                  <span className="text-slate-400">{fmtDatetime(e.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
