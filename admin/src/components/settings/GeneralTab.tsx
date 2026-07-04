'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { IoOpenOutline } from 'react-icons/io5'
import { Card } from '@/components/ui/Card'
import { SettingField } from '@/components/settings/SettingField'
import { settingsApi } from '@/lib/api/settings'

export function GeneralTab() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings-general'], queryFn: () => settingsApi.group('general') })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['settings-general'] })

  return (
    <div className="space-y-4">
      <Card>
        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />)}</div>
        ) : (
          (data?.data ?? []).map((s) => (
            <SettingField
              key={s.key}
              setting={s}
              group="general"
              onSaved={invalidate}
              doubleConfirmLabel={s.key === 'payment_mode' ? 'I understand this changes the platform default and affects all new bookings.' : undefined}
            />
          ))
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">Commission bands</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">The category × tier rate matrix is edited in the Finance module.</p>
          </div>
          <Link href="/finance" className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
            Open in Finance <IoOpenOutline className="size-3" />
          </Link>
        </div>
      </Card>
    </div>
  )
}
