'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoAddOutline, IoDownloadOutline, IoBanOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { toast } from '@/lib/store/toast-store'
import { fmtDate } from '@/lib/utils'
import {
  fraudApi, DENYLIST_TYPE_LABEL, DENYLIST_CATEGORY_LABEL,
  type DenylistEntry, type DenylistHashType, type DenylistCategory,
} from '@/lib/api/fraud'

const TYPE_OPTIONS = Object.entries(DENYLIST_TYPE_LABEL).map(([value, label]) => ({ value, label }))
const STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'lifted', label: 'Lifted' }]

export function FraudDenylistTab() {
  const [page, setPage] = useState(1)
  const [type, setType] = useState<DenylistHashType | ''>('')
  const [status, setStatus] = useState<'active' | 'lifted' | ''>('')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['fraud-denylist', page, type, status, search],
    queryFn: () => fraudApi.denylist({ page, type: type || undefined, status: status || undefined, search }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['fraud-denylist'] })

  const lift = useAuditedMutation<{ id: string }, unknown>({
    capability: 'write:denylist',
    audit: { action: 'fraud.denylist_lift', targetType: 'fraud_denylist', targetId: '', summary: 'Lift this denylist entry. The identifier will no longer be blocked.' },
    mutationFn: (p) => fraudApi.liftFromDenylist(p.id, { reason: p.reason }),
    onSuccess: invalidate,
  })

  async function exportHashes() {
    try {
      const res = await fraudApi.exportDenylist()
      const csv = ['hash_type,hash_value,reason,added_at', ...res.data.map((r) => `${r.hash_type},${r.hash_value},${r.reason},${r.added_at}`)].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'denylist-hashes.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not export the denylist.')
    }
  }

  const columns = useMemo<ColumnDef<DenylistEntry>[]>(() => [
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => DENYLIST_TYPE_LABEL[row.original.type] },
    { accessorKey: 'masked', header: 'Identifier', cell: ({ row }) => <span className="font-mono text-xs">{row.original.masked}</span> },
    { accessorKey: 'reason', header: 'Reason', cell: ({ row }) => DENYLIST_CATEGORY_LABEL[row.original.reason as DenylistCategory] ?? row.original.reason },
    { accessorKey: 'added_at', header: 'Added', cell: ({ row }) => fmtDate(row.original.added_at) },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusPill label={row.original.status} autoVariant /> },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => row.original.status === 'active' && (
        <Can do="write:denylist">
          <button
            type="button"
            disabled={lift.isPending}
            onClick={() => lift.trigger({ id: row.original.id })}
            className="text-xs font-medium text-teal-600 hover:underline disabled:opacity-50 dark:text-teal-400"
          >
            Lift
          </button>
        </Can>
      ),
    },
  ], [lift])

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search by last 4 digits…"
        filters={[
          { key: 'type', label: 'All types', value: type, options: TYPE_OPTIONS, onChange: (v) => { setType(v as DenylistHashType | ''); setPage(1) } },
          { key: 'status', label: 'All statuses', value: status, options: STATUS_OPTIONS, onChange: (v) => { setStatus(v as 'active' | 'lifted' | ''); setPage(1) } },
        ]}
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={exportHashes} className="flex h-9 items-center gap-1.5 rounded-sm border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              <IoDownloadOutline className="size-3.5" /> Export hashes
            </button>
            <Can do="write:denylist">
              <button type="button" onClick={() => setShowAdd(true)} className="flex h-9 items-center gap-1.5 rounded-sm bg-teal-600 px-3 text-xs font-medium text-white hover:bg-teal-700">
                <IoAddOutline className="size-3.5" /> Add to denylist
              </button>
            </Can>
          </div>
        }
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No denylist entries for this filter"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      {showAdd && <AddDenylistModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); invalidate() }} />}
    </div>
  )
}

function AddDenylistModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [hashType, setHashType] = useState<DenylistHashType>('PHONE_HASH')
  const [identifier, setIdentifier] = useState('')
  const [category, setCategory] = useState<DenylistCategory>('CONFIRMED_FRAUD')

  const add = useAuditedMutation<{ hash_type: DenylistHashType; identifier: string; category: DenylistCategory }, unknown>({
    capability: 'write:denylist',
    audit: {
      action: 'fraud.denylist_add',
      targetType: 'fraud_denylist',
      targetId: '',
      summary: 'Add this identifier to the platform-wide denylist. Only its hash is stored — the raw value is never retained.',
    },
    mutationFn: (p) => fraudApi.addToDenylist({ hash_type: p.hash_type, identifier: p.identifier, category: p.category, reason: p.reason }),
    onSuccess: onAdded,
  })

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-sm border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
          <IoBanOutline className="size-4 text-red-500" /> Add to denylist
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          The identifier is hashed before it's stored — the raw value never touches the database.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Identifier type
            <select value={hashType} onChange={(e) => setHashType(e.target.value as DenylistHashType)} className="mt-1 block h-9 w-full rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
              {Object.entries(DENYLIST_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Value to block
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. 0977123456"
              className="mt-1 block h-9 w-full rounded-sm border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value as DenylistCategory)} className="mt-1 block h-9 w-full rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
              {Object.entries(DENYLIST_CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-sm px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">Cancel</button>
          <button
            type="button"
            disabled={!identifier.trim() || add.isPending}
            onClick={() => add.trigger({ hash_type: hashType, identifier: identifier.trim(), category })}
            className="rounded-sm bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
