'use client'

import { useQuery } from '@tanstack/react-query'
import { IoChatbubblesOutline, IoSendOutline, IoCloseCircleOutline, IoTrendingUpOutline } from 'react-icons/io5'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { MetricCard } from '@/components/ui/MetricCard'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusPill } from '@/components/ui/StatusPill'
import { fmtPercent, fmtDate } from '@/lib/utils'
import { whatsappApi } from '@/lib/api/whatsapp'

const AXIS_STYLE = { fontSize: 11, fill: '#94a3b8' }
const GRID_STROKE = '#e2e8f0'

export function WhatsAppOverviewTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-overview'],
    queryFn: () => whatsappApi.overview(),
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Active conversations (24h)" value={isLoading ? '—' : String(data?.kpis.active_conversations_24h ?? 0)} icon={IoChatbubblesOutline} />
        <MetricCard title="Messages received today" value={isLoading ? '—' : String(data?.kpis.messages_received_today ?? 0)} icon={IoSendOutline} />
        <MetricCard title="Failed sends today" value={isLoading ? '—' : String(data?.kpis.failed_sends_today ?? 0)} icon={IoCloseCircleOutline} />
        <MetricCard
          title="Conversation → booking rate"
          value={isLoading || data?.kpis.conversation_to_booking_rate == null ? '—' : fmtPercent(data.kpis.conversation_to_booking_rate)}
          subtitle="Last 30 days"
          icon={IoTrendingUpOutline}
        />
      </div>

      <Card>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Message volume — last 7 days</h3>
        {!isLoading && (data?.volume.length ?? 0) === 0 ? (
          <EmptyState title="No message activity yet" />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.volume ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                <Tooltip labelFormatter={(d) => fmtDate(d as string)} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: 'none', fontSize: 12 }} />
                <Line type="monotone" dataKey="received" stroke="#0d9488" strokeWidth={2} dot={false} name="Received" />
                <Line type="monotone" dataKey="sent" stroke="#f59e0b" strokeWidth={2} dot={false} name="Delivery acks" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">MNO delivery health — last 7 days</h3>
        <p className="mb-3 text-xs text-slate-400">
          Grouped by the recipient's number prefix — WhatsApp's API doesn't report the carrier directly.
        </p>
        {!isLoading && (data?.mno_health.length ?? 0) === 0 ? (
          <EmptyState title="No delivery data yet" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(data?.mno_health ?? []).map((m) => {
              const total = m.delivered + m.failed + m.other
              const rate = total > 0 ? m.delivered / total : 0
              return (
                <div key={m.mno} className="rounded-sm border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{m.mno}</span>
                    <StatusPill label={fmtPercent(rate)} variant={rate >= 0.9 ? 'active' : rate >= 0.7 ? 'warning' : 'danger'} autoVariant={false} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{m.delivered} delivered · {m.failed} failed</p>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
