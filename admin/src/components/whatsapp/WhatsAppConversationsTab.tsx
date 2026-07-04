'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoAlertCircleOutline, IoCloseOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { TabBar } from '@/components/ui/TabBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { fmtRelative } from '@/lib/utils'
import { whatsappApi, type ConversationRow, type ConversationView } from '@/lib/api/whatsapp'

const VIEWS: Array<{ value: ConversationView; label: string }> = [
  { value: '', label: 'All' },
  { value: 'stuck', label: 'Stuck' },
  { value: 'failed', label: 'Failed' },
  { value: 'completed', label: 'Completed' },
]

export function WhatsAppConversationsTab() {
  const [page, setPage] = useState(1)
  const [view, setView] = useState<ConversationView>('')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-conversations', page, view],
    queryFn: () => whatsappApi.conversations({ page, view }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations'] })

  const nudge = useAuditedMutation<{ id: string }, unknown>({
    capability: 'platform.ops',
    audit: { action: 'whatsapp.conversation_nudge', targetType: 'conversation_state', targetId: '', summary: 'Send a re-engagement template to nudge this conversation forward.' },
    mutationFn: (p) => whatsappApi.nudge(p.id, { reason: p.reason }),
    onSuccess: invalidate,
  })

  const markAbandoned = useAuditedMutation<{ id: string }, unknown>({
    capability: 'platform.ops',
    audit: { action: 'whatsapp.conversation_mark_abandoned', targetType: 'conversation_state', targetId: '', summary: 'Mark this conversation as abandoned (moves it to EXPIRED).' },
    mutationFn: (p) => whatsappApi.markAbandoned(p.id, { reason: p.reason }),
    onSuccess: invalidate,
  })

  const columns = useMemo<ColumnDef<ConversationRow>[]>(() => [
    { accessorKey: 'user_name', header: 'User', cell: ({ row }) => (
      <div>
        <p className="font-medium text-slate-800 dark:text-slate-200">{row.original.user_name}</p>
        <p className="text-xs text-slate-400">{row.original.whatsapp_masked}</p>
      </div>
    ) },
    { accessorKey: 'state', header: 'State', cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <StatusPill label={row.original.state} autoVariant />
        {row.original.stuck && <IoAlertCircleOutline className="size-3.5 text-amber-500" aria-label="Stuck" />}
      </div>
    ) },
    { accessorKey: 'sub_state', header: 'Step', cell: ({ row }) => row.original.sub_state ?? '—' },
    { accessorKey: 'last_activity', header: 'Last activity', cell: ({ row }) => row.original.last_activity ? fmtRelative(row.original.last_activity) : '—' },
    { accessorKey: 'booking_created', header: 'Booking', cell: ({ row }) => (
      <StatusPill label={row.original.booking_created ? 'Yes' : 'No'} variant={row.original.booking_created ? 'active' : 'neutral'} autoVariant={false} />
    ) },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => row.original.stuck && (
        <Can do="platform.ops">
          <div className="flex gap-2">
            <button type="button" disabled={nudge.isPending} onClick={() => nudge.trigger({ id: row.original.id })} className="text-xs font-medium text-teal-600 hover:underline disabled:opacity-50 dark:text-teal-400">
              Nudge
            </button>
            <button type="button" disabled={markAbandoned.isPending} onClick={() => markAbandoned.trigger({ id: row.original.id })} className="flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:underline disabled:opacity-50">
              <IoCloseOutline className="size-3.5" /> Abandon
            </button>
          </div>
        </Can>
      ),
    },
  ], [nudge, markAbandoned])

  return (
    <div className="space-y-4">
      <TabBar items={VIEWS} active={view} onChange={(v) => { setView(v); setPage(1) }} ariaLabel="Conversation views" />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No conversations for this view"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />
    </div>
  )
}
