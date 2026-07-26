'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IoInformationCircleOutline } from 'react-icons/io5'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { promotionsApi, type ReferralConfig } from '@/lib/api/promotions'

const labelCls = 'block text-xs font-medium text-slate-600 dark:text-slate-300'
const inputCls =
  'mt-1 w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export function PromotionsReferralsTab() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['promotions-referral-config'], queryFn: () => promotionsApi.referralConfig() })

  const [form, setForm] = useState<ReferralConfig | null>(null)
  useEffect(() => { if (data?.data) setForm(data.data) }, [data])

  const save = useAuditedMutation<{ cfg: ReferralConfig }, unknown>({
    capability: 'write:promotions',
    audit: { action: 'promotion.referral_config_update', targetType: 'referral_config', targetId: '1', summary: 'Update the referral reward configuration.' },
    mutationFn: (p) => promotionsApi.updateReferralConfig({
      enabled: p.cfg.enabled,
      referrer_reward_zmw: p.cfg.referrer_reward_zmw,
      referee_reward_zmw: p.cfg.referee_reward_zmw,
      max_referrals_per_user: p.cfg.max_referrals_per_user,
      budget_cap: p.cfg.budget_cap,
      reason: p.reason,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promotions-referral-config'] }),
  })

  if (!form) return <div className="text-sm text-slate-500">Loading…</div>

  return (
    <div className="max-w-lg space-y-4">
      {!form.implemented && (
        <div className="flex items-start gap-2 rounded-sm bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <IoInformationCircleOutline className="mt-0.5 size-4 shrink-0" />
          <span>The referral mechanic is not yet active. You can configure the rewards here now — they take effect when the feature ships.</span>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        Enable referrals (once implemented)
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Referrer reward (ZMW)</label>
          <input className={inputCls} type="number" min={0} value={form.referrer_reward_zmw} onChange={(e) => setForm({ ...form, referrer_reward_zmw: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Referee reward (ZMW)</label>
          <input className={inputCls} type="number" min={0} value={form.referee_reward_zmw} onChange={(e) => setForm({ ...form, referee_reward_zmw: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Max referrals / user</label>
          <input className={inputCls} type="number" min={1} value={form.max_referrals_per_user ?? ''} onChange={(e) => setForm({ ...form, max_referrals_per_user: e.target.value ? Number(e.target.value) : null })} placeholder="Unlimited" />
        </div>
        <div>
          <label className={labelCls}>Budget cap (ZMW)</label>
          <input className={inputCls} type="number" min={0} value={form.budget_cap ?? ''} onChange={(e) => setForm({ ...form, budget_cap: e.target.value ? Number(e.target.value) : null })} placeholder="Uncapped" />
        </div>
      </div>

      <Can do="write:promotions">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.trigger({ cfg: form })}
          className="rounded-sm bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          Save referral settings
        </button>
      </Can>
    </div>
  )
}
