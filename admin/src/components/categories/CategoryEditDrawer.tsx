'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { IoAddOutline, IoCloseOutline } from 'react-icons/io5'
import { CategoryPicker } from '@/components/ui/CategoryPicker'
import { DetailPanel } from '@/components/ui/DetailPanel'
import { StatusPill } from '@/components/ui/StatusPill'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { toast } from '@/lib/store/toast-store'
import { cn } from '@/lib/utils'
import {
  categoriesApi,
  COMMISSION_BANDS,
  PRICING_MODELS,
  bandLabel,
  displayRate,
  defaultRatesForBand,
  type AdminCategory,
} from '@/lib/api/categories'

// ── Form schema ─────────────────────────────────────────────────────────────

const schema = z.object({
  name:            z.string().min(1, 'Name is required').max(80),
  slug:            z.string().regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, hyphens').max(100).optional().or(z.literal('')),
  parent_id:       z.number().nullable().optional(),
  icon:            z.string().max(100).nullable().optional(),
  display_order:   z.coerce.number().int().min(0).optional(),
  is_active:       z.boolean().optional(),
  commission_band: z.string().nullable().optional(),
  // Category-driven pricing guidance
  default_pricing_model:    z.string().nullable().optional(),
  pricing_rationale:        z.string().max(400).nullable().optional(),
  pricing_mismatch_warning: z.string().max(600).nullable().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  category: AdminCategory | null
  allCategories: AdminCategory[]
  canSetBand: boolean
  onClose: () => void
  onSaved: () => void
}

// ── Component ───────────────────────────────────────────────────────────────

export function CategoryEditDrawer({
  open,
  category,
  // allCategories retained in Props for call-site compatibility; the parent
  // picker now loads the full taxonomy itself (searchable, scales past ~10).
  canSetBand,
  onClose,
  onSaved,
}: Props) {
  const isCreate = category === null
  const [synonyms, setSynonyms]   = useState<string[]>([])
  const [synInput, setSynInput]   = useState('')
  const [recommended, setRecommended] = useState<string[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:            '',
      slug:            '',
      parent_id:       null,
      icon:            '',
      display_order:   0,
      is_active:       false,
      commission_band: null,
      default_pricing_model:    null,
      pricing_rationale:        '',
      pricing_mismatch_warning: '',
    },
  })

  // Reset form when the drawer opens / category changes.
  useEffect(() => {
    if (!open) return
    setServerError(null)
    setSynonyms(category?.synonyms ?? [])
    setSynInput('')
    setRecommended(category?.recommended_pricing_models ?? [])
    reset({
      name:            category?.name ?? '',
      slug:            category?.slug ?? '',
      parent_id:       category?.parent_id ?? null,
      icon:            category?.icon ?? '',
      display_order:   category?.display_order ?? 0,
      is_active:       category?.is_active ?? false,
      commission_band: category?.commission_band ?? null,
      default_pricing_model:    category?.default_pricing_model ?? null,
      pricing_rationale:        category?.pricing_rationale ?? '',
      pricing_mismatch_warning: category?.pricing_mismatch_warning ?? '',
    })
  }, [open, category, reset])

  function toggleRecommended(value: string) {
    setRecommended((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  const watchedBand = watch('commission_band')
  const watchedActive = watch('is_active')

  // Auto-fill commission_rates when band is selected for the first time.
  function onBandChange(value: string) {
    setValue('commission_band', value || null, { shouldDirty: true })
  }

  // Synonym management
  function addSynonym() {
    const t = synInput.trim()
    if (!t || synonyms.includes(t)) return
    setSynonyms((prev) => [...prev, t])
    setSynInput('')
  }

  function removeSynonym(s: string) {
    setSynonyms((prev) => prev.filter((x) => x !== s))
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useAuditedMutation({
    mutationFn: async (payload: FormValues & { reason: string }) => {
      const { reason, ...fields } = payload
      const commissionRates = fields.commission_band
        ? defaultRatesForBand(fields.commission_band)
        : undefined

      const body = {
        ...fields,
        slug:             fields.slug || undefined,
        icon:             fields.icon || null,
        parent_id:        fields.parent_id ?? null,
        synonyms,
        // Category-driven pricing guidance
        default_pricing_model:      fields.default_pricing_model || null,
        recommended_pricing_models: recommended,
        pricing_rationale:          fields.pricing_rationale?.trim() || null,
        pricing_mismatch_warning:   fields.pricing_mismatch_warning?.trim() || null,
        ...(commissionRates ? { commission_rates: commissionRates } : {}),
        reason,
      }

      if (isCreate) {
        return categoriesApi.create(body as Parameters<typeof categoriesApi.create>[0])
      }
      return categoriesApi.update(category!.id, body as Parameters<typeof categoriesApi.update>[1])
    },
    audit: {
      action: isCreate ? 'category.create' : 'category.update',
      targetType: 'category',
      targetId: category ? String(category.id) : 'new',
      summary: isCreate
        ? 'Create a new service category.'
        : `Update category "${category?.name}".`,
    },
    capability: 'categories.manage',
    onSuccess: () => {
      toast.success(isCreate ? 'Category created.' : 'Category updated.')
      onSaved()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Failed to save category.'
      setServerError(msg)
    },
  })

  function onSubmit(values: FormValues) {
    setServerError(null)
    saveMutation.trigger(values)
  }

  // ── Blocking banner: activation without band ───────────────────────────
  const activationBlocked = watchedActive && !watchedBand

  // `recommended` lives outside react-hook-form, so isDirty misses it — track
  // its change explicitly so the Save button enables when only chips change.
  const recommendedChanged =
    JSON.stringify([...recommended].sort()) !==
    JSON.stringify([...(category?.recommended_pricing_models ?? [])].sort())
  const canSave = isCreate || isDirty || recommendedChanged

  const drawerTitle = isCreate ? 'New category' : `Edit: ${category?.name}`
  const drawerSubtitle = isCreate ? undefined : `ID ${category?.id} · slug: ${category?.slug}`

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      title={drawerTitle}
      subtitle={drawerSubtitle}
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={saveMutation.isPending || !canSave}
            className={cn(
              'rounded-sm px-4 py-2 text-sm font-medium transition-colors min-h-[44px]',
              saveMutation.isPending || !canSave
                ? 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-700'
                : 'bg-teal-600 text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500',
            )}
          >
            {saveMutation.isPending ? 'Saving…' : isCreate ? 'Create category' : 'Save changes'}
          </button>
        </div>
      }
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-5"
        aria-label={drawerTitle}
      >
        {/* Server error */}
        {serverError && (
          <div
            role="alert"
            className="rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
          >
            {serverError}
          </div>
        )}

        {/* Activation blocked warning */}
        {activationBlocked && (
          <div
            role="alert"
            className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          >
            A commission band is required before this category can be activated (v3 §8.1).
          </div>
        )}

        {/* Name */}
        <Field label="Name" error={errors.name?.message} required>
          <input
            {...register('name')}
            type="text"
            maxLength={80}
            placeholder="e.g. Home Cleaning"
            className={inputCls(!!errors.name)}
            aria-required="true"
          />
        </Field>

        {/* Slug */}
        <Field label="Slug" error={errors.slug?.message} hint="Auto-generated from name if left blank. Lowercase, hyphens only.">
          <input
            {...register('slug')}
            type="text"
            maxLength={100}
            placeholder="e.g. home-cleaning"
            className={inputCls(!!errors.slug)}
          />
        </Field>

        {/* Parent — searchable picker over the full taxonomy (scales past ~10). */}
        <Field label="Parent category" hint="Leave blank for a top-level category.">
          <CategoryPicker
            value={watch('parent_id') ?? null}
            onChange={(id) => setValue('parent_id', id, { shouldDirty: true })}
            excludeId={category?.id}
            allowNone
            noneLabel="— None (top-level) —"
          />
        </Field>

        {/* Icon */}
        <Field label="Icon" hint="Ionicons name, e.g. sparkles-outline. Displayed in the app.">
          <input
            {...register('icon')}
            type="text"
            maxLength={100}
            placeholder="e.g. sparkles-outline"
            className={inputCls(false)}
          />
        </Field>

        {/* Commission band — gated to categories.set_band */}
        <Field
          label="Commission band"
          error={errors.commission_band?.message}
          hint={
            canSetBand
              ? 'Rate band applied to bookings in this category (v3 §8.1). Required for activation.'
              : 'Requires the categories.set_band permission to change.'
          }
        >
          {canSetBand ? (
            <select
              value={watchedBand ?? ''}
              onChange={(e) => onBandChange(e.target.value)}
              className={inputCls(!!errors.commission_band)}
              aria-label="Commission band"
            >
              <option value="">— Not set (draft only) —</option>
              {COMMISSION_BANDS.map((b) => {
                const tier3 = Math.round(b.defaultRates[3] * 100)
                return (
                  <option key={b.value} value={b.value}>
                    {b.label} · T3 {tier3}%
                  </option>
                )
              })}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              {watchedBand ? (
                <StatusPill
                  label={
                    category
                      ? displayRate(category)
                        ? `${bandLabel(watchedBand)} · ${displayRate(category)}`
                        : bandLabel(watchedBand)
                      : bandLabel(watchedBand)
                  }
                  variant="info"
                />
              ) : (
                <StatusPill label="Not set" variant="warning" />
              )}
              <span className="text-xs text-slate-400">Read-only for your role</span>
            </div>
          )}
        </Field>

        {/* ── Pricing guidance ─────────────────────────────────────────── */}
        <div className="rounded-sm border border-slate-200 p-4 dark:border-slate-700">
          <p className="mb-1 text-sm font-medium text-slate-800 dark:text-slate-200">Pricing guidance</p>
          <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
            Steers providers toward the model that pays fairly for this kind of work. Providers can still override it.
          </p>

          <div className="space-y-4">
            <Field label="Default pricing model" hint="Pre-selected when a provider creates a service here. Leave blank to use the platform default.">
              <select
                {...register('default_pricing_model')}
                className={inputCls(false)}
                aria-label="Default pricing model"
              >
                <option value="">— Use platform default —</option>
                {PRICING_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Recommended models" hint="Choosing anything outside this set shows the provider a mismatch nudge.">
              <div className="flex flex-wrap gap-1.5">
                {PRICING_MODELS.map((m) => {
                  const on = recommended.includes(m.value)
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => toggleRecommended(m.value)}
                      aria-pressed={on}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs transition-colors min-h-[36px]',
                        on
                          ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700',
                      )}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </Field>

            <Field label="Rationale" error={errors.pricing_rationale?.message} hint="Short 'why this pays fairly' line shown to providers. Blank = the model's default line.">
              <textarea
                {...register('pricing_rationale')}
                rows={2}
                maxLength={400}
                placeholder="e.g. You're paid for the result — being fast doesn't cost you money."
                className={inputCls(!!errors.pricing_rationale)}
              />
            </Field>

            <Field label="Mismatch warning" error={errors.pricing_mismatch_warning?.message} hint="Benefit-framed nudge when an ill-suited model is picked. Blank = platform default.">
              <textarea
                {...register('pricing_mismatch_warning')}
                rows={3}
                maxLength={600}
                placeholder="e.g. Most designers charge per project. On hourly, your speed wouldn't be rewarded…"
                className={inputCls(!!errors.pricing_mismatch_warning)}
              />
            </Field>
          </div>
        </div>

        {/* Display order */}
        <Field label="Display order" hint="Lower numbers appear first within siblings.">
          <input
            {...register('display_order')}
            type="number"
            min={0}
            step={1}
            className={inputCls(false)}
          />
        </Field>

        {/* Active toggle */}
        <Field label="Status" error={activationBlocked ? 'Set a commission band to activate' : undefined}>
          <label className="flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={watchedActive}
              onClick={() => setValue('is_active', !watchedActive, { shouldDirty: true })}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200',
                'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2',
                watchedActive ? 'bg-teal-500' : 'bg-slate-200 dark:bg-slate-700',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block size-5 translate-x-0 rounded-full bg-white shadow transition-transform duration-200',
                  watchedActive && 'translate-x-5',
                )}
                aria-hidden="true"
              />
            </button>
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {watchedActive ? 'Active — visible in discovery' : 'Hidden — not shown to customers'}
            </span>
          </label>
        </Field>

        {/* Synonyms */}
        <Field
          label="Synonyms"
          hint="Alternate terms that resolve to this category in search (e.g. 'maid', 'housekeeping' → Home Cleaning)."
        >
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={synInput}
                onChange={(e) => setSynInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addSynonym() }
                }}
                placeholder="Type a synonym and press Enter"
                maxLength={80}
                className={cn(inputCls(false), 'flex-1')}
                aria-label="Add synonym"
              />
              <button
                type="button"
                onClick={addSynonym}
                className="flex items-center gap-1 rounded-sm border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 min-h-[44px]"
                aria-label="Add synonym"
              >
                <IoAddOutline className="size-4" />
              </button>
            </div>

            {synonyms.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="list" aria-label="Current synonyms">
                {synonyms.map((s) => (
                  <span
                    key={s}
                    role="listitem"
                    className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {s}
                    <button
                      type="button"
                      onClick={() => removeSynonym(s)}
                      className="ml-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      aria-label={`Remove synonym "${s}"`}
                    >
                      <IoCloseOutline className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Field>

      </form>
    </DetailPanel>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function inputCls(hasError: boolean) {
  return cn(
    'w-full rounded-sm border px-3 py-2 text-sm transition-colors',
    'bg-white text-slate-900 placeholder:text-slate-400',
    'dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500',
    'focus:outline-none focus:ring-2 focus:ring-teal-500',
    hasError
      ? 'border-red-300 dark:border-red-700'
      : 'border-slate-200 dark:border-slate-600',
  )
}

interface FieldProps {
  label: string
  children: React.ReactNode
  error?: string
  hint?: string
  required?: boolean
}

function Field({ label, children, error, hint, required }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-slate-400 dark:text-slate-500">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
