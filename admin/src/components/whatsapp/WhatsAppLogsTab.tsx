'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { fmtDatetime } from '@/lib/utils'
import { whatsappApi, type WebhookLogRow } from '@/lib/api/whatsapp'

const KIND_OPTIONS = [
  { value: 'message', label: 'Message' },
  { value: 'status', label: 'Delivery status' },
  { value: 'unparseable', label: 'Unparseable' },
]

const STATUS_OPTIONS = [
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
  { value: 'duplicate', label: 'Duplicate' },
]

export function WhatsAppLogsTab() {
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-logs', page, kind, status],
    queryFn: () => whatsappApi.logs({ page, kind, status }),
  })

  const columns = useMemo<ColumnDef<WebhookLogRow>[]>(() => [
    { accessorKey: 'message_id', header: 'Message ID', cell: ({ row }) => (
      <span className="font-mono text-xs text-slate-500">{row.original.message_id ? `${row.original.message_id.slice(0, 12)}…` : '—'}</span>
    ) },
    { accessorKey: 'kind', header: 'Kind', cell: ({ row }) => <span className="capitalize">{row.original.kind}</span> },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => row.original.type ?? '—' },
    { accessorKey: 'from_masked', header: 'From', cell: ({ row }) => row.original.from_masked ?? '—' },
    { accessorKey: 'processing_status', header: 'Status', cell: ({ row }) => (
      <StatusPill label={row.original.processing_status} variant={row.original.processing_status === 'processed' ? 'active' : row.original.processing_status === 'failed' ? 'danger' : 'warning'} autoVariant={false} />
    ) },
    { accessorKey: 'error', header: 'Error', cell: ({ row }) => row.original.error ? <span className="text-xs text-red-600 dark:text-red-400">{row.original.error}</span> : '—' },
    { accessorKey: 'created_at', header: 'Time', cell: ({ row }) => fmtDatetime(row.original.created_at) },
  ], [])

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">Inbound webhook events from the last 48 hours.</p>

      <FilterBar
        filters={[
          { key: 'kind', label: 'All kinds', value: kind, options: KIND_OPTIONS, onChange: (v) => { setKind(v); setPage(1) } },
          { key: 'status', label: 'All statuses', value: status, options: STATUS_OPTIONS, onChange: (v) => { setStatus(v); setPage(1) } },
        ]}
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No webhook events in the last 48 hours"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 30}
        onPageChange={setPage}
      />
    </div>
  )
}
