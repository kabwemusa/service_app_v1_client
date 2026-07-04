'use client'

import { useState } from 'react'
import { IoPulseOutline } from 'react-icons/io5'
import { Card } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { fmtRelative } from '@/lib/utils'
import { useAdminChannel, type AdminQueueEventPayload } from '@/lib/realtime/useAdminChannel'
import { useQueueBadgeStore } from '@/lib/realtime/queue-badge-store'

const TYPE_LABEL: Record<string, string> = {
  'booking.funds_held': 'Funds held',
  'booking.disbursed': 'Disbursed',
  'booking.cancelled': 'Cancelled',
}

/**
 * The Commissions/Payouts ledger UI itself isn't built yet (see the
 * EmptyState on this page) — this just proves the finance real-time stream
 * is live end-to-end (booking.funds_held / booking.disbursed /
 * booking.cancelled) so the ledger can subscribe to the same channel once
 * it exists.
 */
export function FinanceLiveFeed() {
  const [events, setEvents] = useState<AdminQueueEventPayload[]>([])
  const bumpBadge = useQueueBadgeStore((s) => s.increment)

  useAdminChannel('finance', {
    'booking.funds_held': (e) => { setEvents((prev) => [e, ...prev].slice(0, 5)); bumpBadge('finance') },
    'booking.disbursed': (e) => { setEvents((prev) => [e, ...prev].slice(0, 5)); bumpBadge('finance') },
    'booking.cancelled': (e) => { setEvents((prev) => [e, ...prev].slice(0, 5)); bumpBadge('finance') },
  })

  if (events.length === 0) return null

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
        <IoPulseOutline className="size-4 text-teal-500" />
        Live booking events (this session)
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {events.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="text-slate-600 dark:text-slate-400">
              Booking {String(e.payload.booking_id ?? e.entity_id).slice(0, 8)}…
            </span>
            <div className="flex items-center gap-2">
              <StatusPill label={TYPE_LABEL[e.type] ?? e.type} autoVariant />
              <span className="text-xs text-slate-400">{fmtRelative(e.created_at)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
