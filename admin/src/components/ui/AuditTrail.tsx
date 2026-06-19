'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { fmtDatetime } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { RoleBadge } from '@/components/ui/RoleBadge'
import { FilterBar } from '@/components/ui/FilterBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useState } from 'react'
import type { AuditLogEntry, Paginated } from '@/lib/api/types'
import { ClipboardList } from 'lucide-react'

interface AuditTrailProps {
  // When provided, filters to a single target (e.g. a specific user or booking)
  targetType?: string
  targetId?: string
}

export function AuditTrail({ targetType, targetId }: AuditTrailProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [actorFilter, setActorFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', { page, search, actorFilter, targetType, targetId }],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        ...(search && { search }),
        ...(actorFilter && { actor: actorFilter }),
        ...(targetType && { target_type: targetType }),
        ...(targetId && { target_id: targetId }),
      })
      return api.get<Paginated<AuditLogEntry>>(`/api/admin/audit-log?${params}`)
    },
  })

  return (
    <div className="space-y-3">
      <FilterBar
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search by action or targetâ€¦"
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />
          ))}
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          title="No audit entries"
          description="State-changing actions will appear here."
          icon={ClipboardList}
        />
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {data.data.map((entry) => (
            <div key={entry.id} className="flex gap-3 px-4 py-3">
              <Avatar name={entry.actor_name} size="sm" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {entry.actor_name}
                  </span>
                  <RoleBadge role={entry.actor_role} />
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {entry.action}
                  </span>
                  <span className="text-xs text-slate-400">
                    {entry.target_type}/{entry.target_id}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                  <span className="font-medium">Reason:</span> {entry.reason}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {fmtDatetime(entry.created_at)} Â· {entry.ip}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.meta.last_page > 1 && (
        <div className="flex justify-end gap-2 text-xs">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40 dark:border-slate-700"
          >
            Prev
          </button>
          <span className="px-2 py-1 text-slate-500">
            {page} / {data.meta.last_page}
          </span>
          <button
            disabled={page >= data.meta.last_page}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40 dark:border-slate-700"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
