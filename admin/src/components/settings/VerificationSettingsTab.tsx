'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IoCheckmarkCircleOutline, IoCloseCircleOutline, IoPencilOutline } from 'react-icons/io5'
import { Card } from '@/components/ui/Card'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { SettingField } from '@/components/settings/SettingField'
import { settingsApi, type RiskTier } from '@/lib/api/settings'

const ALL_REQUIREMENTS = ['nrc', 'momo_name_match', 'portfolio', 'police_clearance', 'selfie_match']

export function VerificationSettingsTab() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading: settingsLoading } = useQuery({ queryKey: ['settings-verification'], queryFn: () => settingsApi.group('verification') })
  const { data: tiers, isLoading: tiersLoading } = useQuery({ queryKey: ['settings-risk-tiers'], queryFn: () => settingsApi.riskTiers() })
  const { data: denylistConfig } = useQuery({ queryKey: ['settings-denylist-config'], queryFn: () => settingsApi.denylistConfig() })

  const invalidateSettings = () => queryClient.invalidateQueries({ queryKey: ['settings-verification'] })
  const invalidateTiers = () => queryClient.invalidateQueries({ queryKey: ['settings-risk-tiers'] })

  return (
    <div className="space-y-4">
      <Card>
        {settingsLoading ? (
          <div className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
        ) : (
          (settings?.data ?? []).map((s) => <SettingField key={s.key} setting={s} group="verification" onSaved={invalidateSettings} />)
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Risk tier requirements</h3>
        {tiersLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />)}</div>
        ) : (
          <div className="space-y-3">
            {(tiers?.data ?? []).map((t) => (
              <RiskTierRow key={t.risk_tier} tier={t} onSaved={invalidateTiers} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Denylist check config</h3>
        <p className="mb-3 text-xs text-slate-400">Which signals actually trigger an auto-flag today — read-only, reflects the real enforcement code.</p>
        <div className="space-y-1.5">
          {(denylistConfig?.wired ?? []).map((w) => (
            <div key={w.signal} className="flex items-center gap-2 text-sm">
              <IoCheckmarkCircleOutline className="size-4 text-teal-600" />
              <span className="text-slate-700 dark:text-slate-300">{w.signal}</span>
              <span className="text-xs text-slate-400">— checked at {w.checked_at}</span>
            </div>
          ))}
          {(denylistConfig?.not_wired ?? []).map((w) => (
            <div key={w.signal} className="flex items-start gap-2 text-sm">
              <IoCloseCircleOutline className="mt-0.5 size-4 shrink-0 text-slate-300" />
              <div>
                <span className="text-slate-500 dark:text-slate-400">{w.signal}</span>
                <p className="text-xs text-slate-400">{w.reason}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// Provider trust tiers that appear inside each risk tier's requirement map.
const PROVIDER_TIERS = ['tier_1', 'tier_2', 'tier_3', 'tier_4'] as const

function RiskTierRow({ tier, onSaved }: { tier: RiskTier; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [requirements, setRequirements] = useState<Record<string, string[]>>(tier.requirements)

  const presentProviderTiers = PROVIDER_TIERS.filter((t) => t in tier.requirements)

  const update = useAuditedMutation<{ requirements: Record<string, string[]> }, unknown>({
    capability: 'write:settings',
    audit: {
      action: 'settings.risk_tier_update',
      targetType: 'risk_tier_config',
      targetId: String(tier.risk_tier),
      summary: `Update the verification requirements for ${tier.label}.`,
    },
    mutationFn: (p) => settingsApi.updateRiskTier(tier.risk_tier, { requirements: p.requirements, reason: p.reason }),
    onSuccess: () => { setEditing(false); onSaved() },
  })

  function toggle(providerTier: string, req: string, checked: boolean) {
    setRequirements((prev) => {
      const current = prev[providerTier] ?? []
      return {
        ...prev,
        [providerTier]: checked ? [...current, req] : current.filter((r) => r !== req),
      }
    })
  }

  return (
    <div className="rounded-sm border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{tier.label}</span>
          <p className="text-xs text-slate-400">Service risk category — requirements below are by provider tier.</p>
        </div>
        {!editing && (
          <Can do="write:settings">
            <button type="button" onClick={() => setEditing(true)} className="flex shrink-0 items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
              <IoPencilOutline className="size-3.5" /> Edit
            </button>
          </Can>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {presentProviderTiers.map((providerTier) => (
          <div key={providerTier} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Provider {providerTier.replace('tier_', 'Tier ')}
            </p>
            {editing ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {ALL_REQUIREMENTS.map((req) => (
                  <label key={req} className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={(requirements[providerTier] ?? []).includes(req)}
                      onChange={(e) => toggle(providerTier, req, e.target.checked)}
                    />
                    {req.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {(tier.requirements[providerTier] ?? []).map((r) => r.replace(/_/g, ' ')).join(', ') || 'None'}
              </p>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={update.isPending} onClick={() => update.trigger({ requirements })} className="rounded-sm bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50">Save</button>
          <button type="button" onClick={() => { setEditing(false); setRequirements(tier.requirements) }} className="rounded-sm border border-slate-200 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-400">Cancel</button>
        </div>
      )}
    </div>
  )
}
