'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IoTrophyOutline, IoInformationCircleOutline } from 'react-icons/io5'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusPill } from '@/components/ui/StatusPill'
import { fmtPercent } from '@/lib/utils'
import { insightsApi, type RankedProvider } from '@/lib/api/insights'

// Fixed weights from RankingService's organic score (v3.2 §1.3):
// S_organic = 0.25r + 0.15c + 0.15ver + 0.10resp + 0.05f + 0.20d + 0.10p
const TERMS: Array<{ key: keyof RankedProvider['breakdown']; label: string; weight: number }> = [
  { key: 'r', label: 'Rating', weight: 0.25 },
  { key: 'c', label: 'Completion rate', weight: 0.15 },
  { key: 'ver', label: 'Verification tier', weight: 0.15 },
  { key: 'resp', label: 'Response speed', weight: 0.10 },
  { key: 'f', label: 'Freshness (recent activity)', weight: 0.05 },
  { key: 'd', label: 'Proximity to customer', weight: 0.20 },
  { key: 'p', label: 'Price fit', weight: 0.10 },
]

export function RankingTab() {
  const [categoryId, setCategoryId] = useState<number | null>(null)

  const { data: categories, isLoading: categoriesLoading } = useQuery({
    queryKey: ['insights-ranking-categories'],
    queryFn: () => insightsApi.rankingCategories(),
  })

  const { data: ranking, isLoading: rankingLoading } = useQuery({
    queryKey: ['insights-ranking', categoryId],
    queryFn: () => insightsApi.ranking(categoryId as number),
    enabled: categoryId !== null,
  })

  const cats = categories?.data ?? []

  return (
    <div className="space-y-4">
      <Card>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
          Category
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            disabled={categoriesLoading}
            className="mt-1 block h-9 w-full max-w-sm rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            <option value="">Select a category…</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-400">
          <IoInformationCircleOutline className="mt-0.5 size-3.5 shrink-0" />
          Sorted by the exact organic search-ranking score customers see when browsing this category with no
          delivery location set. A specific customer&apos;s distance to each provider shifts the order slightly at
          search time — proximity here is shown as 0 (no location).
        </p>
      </Card>

      {categoryId === null ? (
        <EmptyState title="Pick a category" description="Choose a category above to see its ranked providers and why they rank where they do." icon={IoTrophyOutline} />
      ) : rankingLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-sm bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : (ranking?.providers.length ?? 0) === 0 ? (
        <EmptyState title="No eligible providers in this category" description="No listing here currently clears the hard filters (trust tier, profile completeness, trust score floor) that search applies." icon={IoTrophyOutline} />
      ) : (
        <div className="space-y-3">
          {(ranking?.providers ?? []).map((p) => (
            <ProviderRankCard key={p.service_id} provider={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderRankCard({ provider }: { provider: RankedProvider }) {
  const [expanded, setExpanded] = useState(provider.rank === 1)
  const isFirst = provider.rank === 1

  return (
    <Card className={isFirst ? 'border-teal-300 dark:border-teal-700' : undefined}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3">
          <span
            className={
              'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ' +
              (isFirst ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300')
            }
          >
            {provider.rank}
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
              {provider.provider_name}
              {isFirst && <StatusPill label="Ranks first" variant="active" autoVariant={false} />}
            </p>
            <p className="text-xs text-slate-400">{provider.service_title} · Tier {provider.trust_tier} · {provider.completed_jobs} completed jobs</p>
          </div>
        </div>
        <span className="shrink-0 text-sm font-medium text-slate-700 dark:text-slate-300">
          {provider.breakdown.score.toFixed(3)}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          {TERMS.map((t) => {
            const value = provider.breakdown[t.key] as number
            const contribution = value * t.weight
            return (
              <div key={t.key} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 text-slate-500 dark:text-slate-400">{t.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.round(value * 100)}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right text-slate-500 dark:text-slate-400">
                  {fmtPercent(value)} × {Math.round(t.weight * 100)}% = {contribution.toFixed(3)}
                </span>
              </div>
            )
          })}
          <BoostNotes provider={provider} />
        </div>
      )}
    </Card>
  )
}

function BoostNotes({ provider }: { provider: RankedProvider }) {
  const { b_cold, b_personal, m_tier } = provider.breakdown
  const notes: string[] = []
  if (b_cold > 0) notes.push(`New-provider boost: +${b_cold.toFixed(2)}`)
  if (b_personal > 0) notes.push(`Personalization boost: +${b_personal.toFixed(2)}`)
  if (m_tier !== 1) notes.push(`Tier 1 multiplier: ×${m_tier}`)

  if (notes.length === 0) return null

  return (
    <p className="pt-1 text-xs text-slate-400">{notes.join(' · ')}</p>
  )
}
