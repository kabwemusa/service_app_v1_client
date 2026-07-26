'use client'

import { useEffect, useState } from 'react'
import {
  IoAddOutline, IoTrashOutline, IoArrowUpOutline, IoArrowDownOutline,
} from 'react-icons/io5'
import { DetailPanel } from '@/components/ui/DetailPanel'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { toast } from '@/lib/store/toast-store'
import { cn } from '@/lib/utils'
import {
  legalAdminApi, DOC_LABEL,
  type LegalDocumentDetail, type LegalDocumentType, type LegalSection,
} from '@/lib/api/legal'

// The editor works on a DRAFT. Two modes:
//   • create — new version of a chosen document (optionally seeded from `cloneFrom`)
//   • edit   — an existing draft (published/archived versions are immutable server-side)
interface Props {
  open: boolean
  mode: 'create' | 'edit'
  doc: LegalDocumentDetail | null       // the draft being edited (edit mode)
  cloneFrom?: LegalDocumentDetail | null // starting content for a new version
  defaultType?: LegalDocumentType        // preselected type in create mode
  onClose: () => void
  onSaved: () => void
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export function LegalEditDrawer({ open, mode, doc, cloneFrom, defaultType, onClose, onSaved }: Props) {
  const [type, setType] = useState<LegalDocumentType>('terms_of_service')
  const [version, setVersion] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [intro, setIntro] = useState('')
  const [isMaterial, setIsMaterial] = useState(true)
  const [sections, setSections] = useState<LegalSection[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setServerError(null)
    const source = mode === 'edit' ? doc : cloneFrom
    setType(mode === 'edit' ? (doc?.type ?? 'terms_of_service') : (defaultType ?? cloneFrom?.type ?? 'terms_of_service'))
    setVersion(mode === 'edit' ? (doc?.version ?? '') : '')
    setTitle(source?.title ?? DOC_LABEL[defaultType ?? cloneFrom?.type ?? doc?.type ?? 'terms_of_service'])
    setSummary(source?.summary ?? '')
    setIntro(source?.content.intro ?? '')
    setIsMaterial(source?.is_material ?? true)
    setSections(source?.content.sections?.map((s) => ({ ...s })) ?? [])
  }, [open, mode, doc, cloneFrom, defaultType])

  // ── Section mutations (local) ──────────────────────────────────────────────
  const updateSection = (i: number, patch: Partial<LegalSection>) =>
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const addSection = () =>
    setSections((prev) => [...prev, { id: `section-${prev.length + 1}`, title: 'New section', level: 2, body: '' }])
  const removeSection = (i: number) => setSections((prev) => prev.filter((_, idx) => idx !== i))
  const moveSection = (i: number, dir: -1 | 1) =>
    setSections((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  // ── Save ────────────────────────────────────────────────────────────────────
  const save = useAuditedMutation({
    mutationFn: async (payload: { reason: string }) => {
      const content = { intro, sections }
      if (mode === 'create') {
        return legalAdminApi.create({ type, version, title, summary, is_material: isMaterial, content, reason: payload.reason })
      }
      return legalAdminApi.update(doc!.id, { title, summary, version, is_material: isMaterial, content, reason: payload.reason })
    },
    audit: {
      action: mode === 'create' ? 'legal.document.create' : 'legal.document.update',
      targetType: 'legal_document',
      targetId: doc?.id ?? 'new',
      summary: mode === 'create'
        ? `Create a new draft version of ${DOC_LABEL[type]}.`
        : `Edit draft ${doc?.version} of ${DOC_LABEL[type]}.`,
    },
    capability: 'legal.manage',
    onSuccess: () => {
      toast.success(mode === 'create' ? 'Draft version created.' : 'Draft updated.')
      onSaved()
    },
    onError: (err) => setServerError(err instanceof Error ? err.message : 'Failed to save.'),
  })

  const canSave = version.trim().length > 0 && title.trim().length > 0 && sections.length > 0 &&
    sections.every((s) => s.id.trim() && s.title.trim())

  const drawerTitle = mode === 'create' ? 'New version' : `Edit draft: ${doc?.version}`

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      title={drawerTitle}
      subtitle={DOC_LABEL[type]}
      width="xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onClose}
            className="rounded-sm px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="button" onClick={() => save.trigger({})} disabled={!canSave || save.isPending}
            className={cn('min-h-[44px] rounded-sm px-4 py-2 text-sm font-medium transition-colors',
              !canSave || save.isPending
                ? 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-700'
                : 'bg-teal-600 text-white hover:bg-teal-700')}>
            {save.isPending ? 'Saving…' : mode === 'create' ? 'Create draft' : 'Save changes'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div role="note" className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          You are editing a <strong>draft</strong>. Published versions are immutable — to change live
          text, create a new version and publish it (that prompts every user to re-consent).
        </div>

        {serverError && (
          <div role="alert" className="rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {serverError}
          </div>
        )}

        {mode === 'create' && (
          <Field label="Document" required>
            <select value={type} onChange={(e) => setType(e.target.value as LegalDocumentType)} className={inputCls(false)}>
              {(Object.keys(DOC_LABEL) as LegalDocumentType[]).map((t) => (
                <option key={t} value={t}>{DOC_LABEL[t]}</option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Version" required hint="e.g. 1.0.0">
            <input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40} placeholder="1.0.0" className={inputCls(false)} />
          </Field>
          <Field label="Material change?" hint="If on, publishing forces existing users to re-consent.">
            <Toggle checked={isMaterial} onChange={setIsMaterial} onLabel="Material — re-consent required" offLabel="Minor — no re-consent" />
          </Field>
        </div>

        <Field label="Title" required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputCls(false)} />
        </Field>

        <Field label="Summary" hint="One-line description shown in the list.">
          <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} className={inputCls(false)} />
        </Field>

        <Field label="Intro" hint="Markdown. Shown above the sections.">
          <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} className={cn(inputCls(false), 'font-mono text-xs leading-relaxed')} />
        </Field>

        {/* Sections */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Sections ({sections.length})</span>
            <button type="button" onClick={addSection}
              className="flex items-center gap-1 rounded-sm border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              <IoAddOutline className="size-4" /> Add section
            </button>
          </div>

          {sections.map((s, i) => (
            <div key={i} className="space-y-2 rounded-sm border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <input value={s.title} onChange={(e) => updateSection(i, { title: e.target.value })}
                  placeholder="Section heading" className={cn(inputCls(false), 'flex-1 font-medium')} />
                <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0}
                  className="rounded-sm p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-700" aria-label="Move up">
                  <IoArrowUpOutline className="size-4" />
                </button>
                <button type="button" onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1}
                  className="rounded-sm p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-700" aria-label="Move down">
                  <IoArrowDownOutline className="size-4" />
                </button>
                <button type="button" onClick={() => removeSection(i)}
                  className="rounded-sm p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30" aria-label="Remove section">
                  <IoTrashOutline className="size-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">Anchor</span>
                <input value={s.id}
                  onChange={(e) => updateSection(i, { id: slugify(e.target.value) })}
                  onBlur={() => { if (!s.id.trim()) updateSection(i, { id: slugify(s.title) }) }}
                  placeholder="section-anchor"
                  className={cn(inputCls(false), 'flex-1 font-mono text-xs')} />
              </div>
              <textarea value={s.body} onChange={(e) => updateSection(i, { body: e.target.value })}
                rows={4} placeholder="Section body (markdown)…"
                className={cn(inputCls(false), 'font-mono text-xs leading-relaxed')} />
            </div>
          ))}

          {sections.length === 0 && (
            <p className="rounded-sm border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400 dark:border-slate-700">
              No sections yet. Add at least one.
            </p>
          )}
        </div>
      </div>
    </DetailPanel>
  )
}

// ── Small primitives ─────────────────────────────────────────────────────────

function inputCls(hasError: boolean) {
  return cn(
    'w-full rounded-sm border px-3 py-2 text-sm transition-colors',
    'bg-white text-slate-900 placeholder:text-slate-400',
    'dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500',
    'focus:outline-none focus:ring-2 focus:ring-teal-500',
    hasError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-600',
  )
}

function Field({ label, children, hint, required }: { label: string; children: React.ReactNode; hint?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}{required && <span className="ml-0.5 text-red-500" aria-hidden>*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, onLabel, offLabel }: { checked: boolean; onChange: (v: boolean) => void; onLabel: string; offLabel: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn('relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors',
          checked ? 'bg-teal-500' : 'bg-slate-200 dark:bg-slate-700')}>
        <span className={cn('pointer-events-none inline-block size-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} aria-hidden />
      </button>
      <span className="text-xs text-slate-600 dark:text-slate-400">{checked ? onLabel : offLabel}</span>
    </label>
  )
}
