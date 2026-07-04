'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { SettingField } from '@/components/settings/SettingField'
import { settingsApi } from '@/lib/api/settings'

export function AlertsTab() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings-alerts'], queryFn: () => settingsApi.group('alerts') })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['settings-alerts'] })

  const thresholds = (data?.data ?? []).filter((s) => s.type !== 'routing')
  const routing = (data?.data ?? []).filter((s) => s.type === 'routing')

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        These thresholds and routes are recorded configuration — there is no automated alert dispatcher reading them yet, so treat this as the target design to wire up next.
      </div>

      <Card>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Thresholds</h3>
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
        ) : (
          thresholds.map((s) => <SettingField key={s.key} setting={s} group="alerts" onSaved={invalidate} />)
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Routing</h3>
        <p className="mb-2 text-xs text-slate-400">Which admin roles receive which alerts, and over which channel.</p>
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
        ) : (
          routing.map((s) => <SettingField key={s.key} setting={s} group="alerts" onSaved={invalidate} />)
        )}
      </Card>
    </div>
  )
}
