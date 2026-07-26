'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IoInformationCircleOutline, IoEyeOutline } from 'react-icons/io5'
import { DetailPanel } from '@/components/ui/DetailPanel'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { toast } from '@/lib/store/toast-store'
import {
  promotionsApi,
  type AudienceType,
  type CampaignInput,
  type PlacementSlot,
  AUDIENCE_FILTER_LABELS,
  OFFER_TYPE_LABELS,
  PLACEMENT_LABELS,
} from '@/lib/api/promotions'

const AUDIENCE_FILTERS: Record<AudienceType, string[]> = {
  CUSTOMER: ['NEW_CUSTOMERS', 'ALL_CUSTOMERS', 'LAPSED', 'BY_AREA', 'BY_CATEGORY'],
  PROVIDER: ['NEW_PROVIDERS', 'LOW_ACTIVITY', 'BY_AREA', 'BY_CATEGORY'],
}

const OFFER_TYPES: Record<AudienceType, string[]> = {
  CUSTOMER: ['PERCENT_OFF', 'AMOUNT_OFF', 'FREE_SERVICE_FEE'],
  PROVIDER: ['ZERO_COMMISSION', 'REDUCED_COMMISSION', 'BONUS'],
}

const APP_PLACEMENTS: PlacementSlot[] = ['APP_HOME_BANNER', 'APP_SEARCH_BADGE', 'APP_CHECKOUT']
const COMING_SOON: PlacementSlot[] = ['PWA_HOME_BANNER', 'PWA_SEARCH_BADGE', 'PWA_CHECKOUT', 'WHATSAPP_BROADCAST']

interface Props {
  open: boolean
  onClose: () => void
  /** 'code' pre-selects checkout + requires a code; 'campaign' is the full form. */
  mode: 'campaign' | 'code'
}

const labelCls = 'block text-xs font-medium text-slate-600 dark:text-slate-300'
const inputCls =
  'mt-1 w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const stepTitleCls = 'text-sm font-semibold text-slate-800 dark:text-slate-200'

export function CampaignComposer({ open, onClose, mode }: Props) {
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [audienceType, setAudienceType] = useState<AudienceType>('CUSTOMER')
  const [audienceFilter, setAudienceFilter] = useState('ALL_CUSTOMERS')
  const [lapsedDays, setLapsedDays] = useState('')
  const [categoryIds, setCategoryIds] = useState('')
  const [areaRegions, setAreaRegions] = useState('')
  const [offerType, setOfferType] = useState('PERCENT_OFF')
  const [offerValue, setOfferValue] = useState('')
  const [placements, setPlacements] = useState<PlacementSlot[]>(
    mode === 'code' ? ['APP_CHECKOUT'] : ['APP_HOME_BANNER'],
  )
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaAction, setCtaAction] = useState('')
  const [badgeLabel, setBadgeLabel] = useState('')
  const [code, setCode] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [budgetCap, setBudgetCap] = useState('')
  const [maxUsesPerUser, setMaxUsesPerUser] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  // Reset offer/filter defaults when the audience type flips.
  useEffect(() => {
    setAudienceFilter(AUDIENCE_FILTERS[audienceType][0])
    setOfferType(OFFER_TYPES[audienceType][0])
  }, [audienceType])

  const audienceParams = useMemo(() => {
    const p: Record<string, unknown> = {}
    if (audienceFilter === 'LAPSED' && lapsedDays) p.lapsed_days = Number(lapsedDays)
    if (audienceFilter === 'BY_CATEGORY' && categoryIds) {
      p.category_ids = categoryIds.split(',').map((s) => Number(s.trim())).filter(Boolean)
    }
    if (audienceFilter === 'BY_AREA' && areaRegions) {
      p.area_regions = areaRegions.split(',').map((s) => s.trim()).filter(Boolean)
    }
    return p
  }, [audienceFilter, lapsedDays, categoryIds, areaRegions])

  // Live audience-size estimate for the composer.
  const { data: estimate } = useQuery({
    queryKey: ['promotions-audience', audienceType, audienceFilter, audienceParams],
    queryFn: () =>
      promotionsApi.audienceEstimate({ audience_type: audienceType, audience_filter: audienceFilter, audience_params: audienceParams }),
    enabled: open,
  })

  function buildPayload(launch: boolean): CampaignInput | null {
    if (!name.trim()) { toast.error('Give the campaign a name.'); return null }
    if (mode === 'code' && !code.trim()) { toast.error('A promo code campaign needs a code.'); return null }
    if (offerType !== 'FREE_SERVICE_FEE' && !offerValue) { toast.error('Enter an offer value.'); return null }
    if (placements.length === 0) { toast.error('Pick at least one placement.'); return null }

    return {
      name: name.trim(),
      audience_type: audienceType,
      audience_filter: audienceFilter,
      audience_params: audienceParams,
      offer_type: offerType,
      offer_value: offerValue ? Number(offerValue) : 0,
      placements,
      content: {
        ...(title && { title }),
        ...(subtitle && { subtitle }),
        ...(ctaLabel && { cta_label: ctaLabel }),
        ...(ctaAction && { cta_action: ctaAction }),
        ...(badgeLabel && { badge_label: badgeLabel }),
      },
      ...(mode === 'code' && { code: code.trim(), code_multi_use: true }),
      start_at: startAt || null,
      end_at: endAt || null,
      budget_cap: budgetCap ? Number(budgetCap) : null,
      max_uses_per_user: maxUsesPerUser ? Number(maxUsesPerUser) : null,
      launch,
    }
  }

  const create = useAuditedMutation<{ input: CampaignInput }, unknown>({
    capability: 'write:promotions',
    audit: {
      action: 'promotion.create',
      targetType: 'campaign',
      targetId: '',
      summary: 'Create this campaign. Customer discounts are absorbed by Sebenza — the provider is paid in full.',
    },
    mutationFn: (p) => promotionsApi.create({ ...p.input, reason: p.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions-campaigns'] })
      queryClient.invalidateQueries({ queryKey: ['promotions-overview'] })
      onClose()
    },
  })

  function submit(launch: boolean) {
    const input = buildPayload(launch)
    if (input) create.trigger({ input })
  }

  const isCustomer = audienceType === 'CUSTOMER'

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      title={mode === 'code' ? 'New promo code' : 'New campaign'}
      subtitle="Audience → offer → placements → schedule"
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300"
          >
            <IoEyeOutline className="size-4" /> Preview placements
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => submit(false)}
              className="rounded-sm border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => submit(true)}
              className="rounded-sm bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              Launch
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 1 — Who is this for? */}
        <section className="space-y-2">
          <p className={stepTitleCls}>1 · Who is this for?</p>
          <div className="flex gap-2">
            {(['CUSTOMER', 'PROVIDER'] as AudienceType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setAudienceType(t)}
                disabled={mode === 'code' && t === 'PROVIDER'}
                className={`flex-1 rounded-sm border px-3 py-2 text-sm font-medium disabled:opacity-40 ${
                  audienceType === t
                    ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                    : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                }`}
              >
                {t === 'CUSTOMER' ? 'Customers' : 'Providers'}
              </button>
            ))}
          </div>
          <div>
            <label className={labelCls}>Campaign name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New customer welcome" />
          </div>
        </section>

        {/* 2 — Audience */}
        <section className="space-y-2">
          <p className={stepTitleCls}>2 · Audience</p>
          <select className={inputCls} value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value)}>
            {AUDIENCE_FILTERS[audienceType].map((f) => (
              <option key={f} value={f}>{AUDIENCE_FILTER_LABELS[f] ?? f}</option>
            ))}
          </select>
          {audienceFilter === 'LAPSED' && (
            <input className={inputCls} type="number" min={1} value={lapsedDays} onChange={(e) => setLapsedDays(e.target.value)} placeholder="Inactive days (default 60)" />
          )}
          {audienceFilter === 'BY_CATEGORY' && (
            <input className={inputCls} value={categoryIds} onChange={(e) => setCategoryIds(e.target.value)} placeholder="Category IDs, comma-separated (e.g. 3, 7)" />
          )}
          {audienceFilter === 'BY_AREA' && (
            <input className={inputCls} value={areaRegions} onChange={(e) => setAreaRegions(e.target.value)} placeholder="Regions, comma-separated (e.g. Lusaka, Ndola)" />
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Estimated audience:{' '}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {estimate ? estimate.estimated_size.toLocaleString() : '…'} {isCustomer ? 'customers' : 'providers'}
            </span>{' '}
            — resolved live at send time.
          </p>
        </section>

        {/* 3 — The offer */}
        <section className="space-y-2">
          <p className={stepTitleCls}>3 · The offer</p>
          <select className={inputCls} value={offerType} onChange={(e) => setOfferType(e.target.value)}>
            {OFFER_TYPES[audienceType].map((o) => (
              <option key={o} value={o}>{OFFER_TYPE_LABELS[o] ?? o}</option>
            ))}
          </select>
          {offerType !== 'FREE_SERVICE_FEE' && (
            <input
              className={inputCls}
              type="number"
              min={0}
              value={offerValue}
              onChange={(e) => setOfferValue(e.target.value)}
              placeholder={offerType.includes('PERCENT') || offerType.includes('COMMISSION') ? 'Percent (e.g. 20)' : 'Amount in ZMW / job count'}
            />
          )}
          {isCustomer && (
            <div className="flex items-start gap-2 rounded-sm bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <IoInformationCircleOutline className="mt-0.5 size-4 shrink-0" />
              <span>Sebenza absorbs the discount — the provider is paid in full.</span>
            </div>
          )}
        </section>

        {/* 4 — Placements */}
        <section className="space-y-2">
          <p className={stepTitleCls}>4 · Where should it appear?</p>
          {APP_PLACEMENTS.map((slot) => (
            <label key={slot} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={placements.includes(slot)}
                onChange={(e) =>
                  setPlacements((prev) => (e.target.checked ? [...prev, slot] : prev.filter((s) => s !== slot)))
                }
              />
              {PLACEMENT_LABELS[slot]}
            </label>
          ))}
          {COMING_SOON.map((slot) => (
            <label key={slot} className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-600">
              <input type="checkbox" disabled />
              {PLACEMENT_LABELS[slot]} <span className="text-[10px] uppercase tracking-wide">coming soon</span>
            </label>
          ))}

          {(placements.includes('APP_HOME_BANNER')) && (
            <div className="mt-2 space-y-2 rounded-sm border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-xs font-medium text-slate-500">Banner content</p>
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Banner title" />
              <input className={inputCls} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Banner subtitle" />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="CTA label" />
                <input className={inputCls} value={ctaAction} onChange={(e) => setCtaAction(e.target.value)} placeholder="CTA action (e.g. Search?q=cleaning)" />
              </div>
            </div>
          )}
          {placements.includes('APP_SEARCH_BADGE') && (
            <input className={inputCls} value={badgeLabel} onChange={(e) => setBadgeLabel(e.target.value)} placeholder="Badge label (defaults from the offer, e.g. 20% off)" />
          )}
        </section>

        {/* 5 — Schedule & limits */}
        <section className="space-y-2">
          <p className={stepTitleCls}>5 · Schedule &amp; limits</p>
          {mode === 'code' && (
            <div>
              <label className={labelCls}>Promo code</label>
              <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME20" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Start</label>
              <input className={inputCls} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>End</label>
              <input className={inputCls} type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Budget cap (ZMW)</label>
              <input className={inputCls} type="number" min={0} value={budgetCap} onChange={(e) => setBudgetCap(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className={labelCls}>Max uses / customer</label>
              <input className={inputCls} type="number" min={1} value={maxUsesPerUser} onChange={(e) => setMaxUsesPerUser(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Auto-stops at the budget cap.</p>
        </section>

        {showPreview && (
          <div className="rounded-sm border border-teal-200 bg-teal-50 p-3 text-xs text-teal-900 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-200">
            <p className="font-medium">This will appear in:</p>
            <ul className="mt-1 list-disc pl-4">
              {placements.map((s) => <li key={s}>{PLACEMENT_LABELS[s]}</li>)}
            </ul>
          </div>
        )}
      </div>
    </DetailPanel>
  )
}
