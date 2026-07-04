'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { SettingField } from '@/components/settings/SettingField'
import { settingsApi } from '@/lib/api/settings'

export function DispatchSettingsTab() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings-dispatch'], queryFn: () => settingsApi.group('dispatch') })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['settings-dispatch'] })

  const fairness = (data?.data ?? []).filter((s) => s.key.startsWith('fairness_') || s.key.startsWith('geo_') || s.key === 'cascade_depth_limit')
  const weights = (data?.data ?? []).filter((s) => s.key.startsWith('trust_weight_'))

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Fairness &amp; geo</h3>
        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />)}</div>
        ) : (
          fairness.map((s) => <SettingField key={s.key} setting={s} group="dispatch" onSaved={invalidate} />)
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Trust score weights per tier</h3>
        <p className="mb-2 text-xs text-slate-400">Each tier's four signal weights must sum to 100%.</p>
        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />)}</div>
        ) : (
          weights.map((s) => <SettingField key={s.key} setting={s} group="dispatch" onSaved={invalidate} />)
        )}
      </Card>
    </div>
  )
}
