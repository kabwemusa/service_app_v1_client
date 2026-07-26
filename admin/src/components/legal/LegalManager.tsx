'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IoAddOutline, IoCreateOutline, IoCloudUploadOutline, IoArchiveOutline,
  IoTrashOutline, IoDuplicateOutline, IoDocumentTextOutline,
} from 'react-icons/io5'
import { StatusPill } from '@/components/ui/StatusPill'
import { TabBar } from '@/components/ui/TabBar'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { toast } from '@/lib/store/toast-store'
import { cn } from '@/lib/utils'
import {
  legalAdminApi, DOC_LABEL, STATUS_VARIANT,
  type LegalDocumentDetail, type LegalGroup, type LegalVersionSummary, type LegalDocumentType,
} from '@/lib/api/legal'
import { LegalEditDrawer } from './LegalEditDrawer'
import { DataRequestsPanel } from './DataRequestsPanel'

type Tab = 'documents' | 'requests'

export function LegalManager() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('documents')

  const { data, isLoading } = useQuery({
    queryKey: ['legal-documents'],
    queryFn: () => legalAdminApi.list(),
  })

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editDoc, setEditDoc] = useState<LegalDocumentDetail | null>(null)
  const [cloneDoc, setCloneDoc] = useState<LegalDocumentDetail | null>(null)
  const [createType, setCreateType] = useState<LegalDocumentType | undefined>(undefined)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['legal-documents'] })

  const openEdit = async (id: string) => {
    setLoadingId(id)
    try {
      const res = await legalAdminApi.get(id)
      setEditDoc(res.data); setCloneDoc(null); setDrawerMode('edit'); setDrawerOpen(true)
    } catch { toast.error('Could not load that version.') } finally { setLoadingId(null) }
  }

  const openCloneFrom = async (id: string) => {
    setLoadingId(id)
    try {
      const res = await legalAdminApi.get(id)
      setCloneDoc(res.data); setEditDoc(null); setCreateType(res.data.type); setDrawerMode('create'); setDrawerOpen(true)
    } catch { toast.error('Could not load that version.') } finally { setLoadingId(null) }
  }

  const openCreateBlank = () => {
    setCloneDoc(null); setEditDoc(null); setCreateType(undefined); setDrawerMode('create'); setDrawerOpen(true)
  }

  const draftMode = data?.data.draft_mode ?? false
  const groups = data?.data.groups ?? []

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Legal &amp; Consent</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage the versioned Terms of Service, Privacy Policy and User Agreement, and action
          data-subject requests. Publishing a material version prompts every user to re-consent.
        </p>
      </header>

      {draftMode && (
        <div role="note" className="mb-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <strong>Draft mode is on</strong> (non-production). Users see a &ldquo;DRAFT — pending legal review&rdquo;
          banner, and unpublished drafts are shown in the apps. Turn it off in production before launch.
        </div>
      )}

      <TabBar
        active={tab}
        onChange={setTab}
        ariaLabel="Legal sections"
        items={[
          { value: 'documents', label: 'Documents' },
          { value: 'requests', label: 'Data requests' },
        ]}
        className="mb-5"
      />

      {tab === 'requests' ? (
        <DataRequestsPanel />
      ) : isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex justify-end">
            <button type="button" onClick={openCreateBlank}
              className="flex items-center gap-1.5 rounded-sm bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700">
              <IoAddOutline className="size-4" /> New version
            </button>
          </div>

          {groups.map((group) => (
            <DocumentGroup
              key={group.type}
              group={group}
              loadingId={loadingId}
              onEdit={openEdit}
              onCloneFrom={openCloneFrom}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      <LegalEditDrawer
        open={drawerOpen}
        mode={drawerMode}
        doc={editDoc}
        cloneFrom={cloneDoc}
        defaultType={createType}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => { setDrawerOpen(false); refresh() }}
      />
    </div>
  )
}

// ── One document type + its versions ─────────────────────────────────────────

function DocumentGroup({
  group, loadingId, onEdit, onCloneFrom, onChanged,
}: {
  group: LegalGroup
  loadingId: string | null
  onEdit: (id: string) => void
  onCloneFrom: (id: string) => void
  onChanged: () => void
}) {
  return (
    <section className="rounded-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <IoDocumentTextOutline className="size-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{group.label}</h2>
        {group.current_version
          ? <span className="ml-auto text-xs text-slate-500">Live: v{group.current_version}</span>
          : <span className="ml-auto text-xs text-amber-600">No live version</span>}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {group.versions.length === 0 && (
          <p className="px-4 py-4 text-xs text-slate-400">No versions yet.</p>
        )}
        {group.versions.map((v) => (
          <VersionRow key={v.id} v={v} busy={loadingId === v.id} onEdit={onEdit} onCloneFrom={onCloneFrom} onChanged={onChanged} />
        ))}
      </div>
    </section>
  )
}

function VersionRow({
  v, busy, onEdit, onCloneFrom, onChanged,
}: {
  v: LegalVersionSummary
  busy: boolean
  onEdit: (id: string) => void
  onCloneFrom: (id: string) => void
  onChanged: () => void
}) {
  const publish = useAuditedMutation({
    mutationFn: (p: { reason: string }) => legalAdminApi.publish(v.id, { reason: p.reason }),
    audit: { action: 'legal.document.publish', targetType: 'legal_document', targetId: v.id,
      summary: `Publish ${DOC_LABEL[v.type]} v${v.version}. This becomes the live version and prompts users to re-consent.` },
    capability: 'legal.manage',
    onSuccess: () => { toast.success('Version published.'); onChanged() },
  })
  const archive = useAuditedMutation({
    mutationFn: (p: { reason: string }) => legalAdminApi.archive(v.id, { reason: p.reason }),
    audit: { action: 'legal.document.archive', targetType: 'legal_document', targetId: v.id, summary: `Archive ${DOC_LABEL[v.type]} v${v.version}.` },
    capability: 'legal.manage',
    onSuccess: () => { toast.success('Version archived.'); onChanged() },
  })
  const remove = useAuditedMutation({
    mutationFn: (p: { reason: string }) => legalAdminApi.remove(v.id, { reason: p.reason }),
    audit: { action: 'legal.document.delete', targetType: 'legal_document', targetId: v.id, summary: `Delete draft ${DOC_LABEL[v.type]} v${v.version}.` },
    capability: 'legal.manage',
    onSuccess: () => { toast.success('Draft deleted.'); onChanged() },
  })

  const busyAny = busy || publish.isPending || archive.isPending || remove.isPending

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span className="font-mono text-sm text-slate-700 dark:text-slate-300">v{v.version}</span>
      <StatusPill label={v.status} variant={STATUS_VARIANT[v.status]} autoVariant={false} />
      {v.is_material && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800">material</span>}
      <span className="text-xs text-slate-400">{v.section_count} sections</span>
      {v.effective_date && <span className="text-xs text-slate-400">· effective {v.effective_date}</span>}

      <div className="ml-auto flex items-center gap-1">
        {v.status === 'draft' && (
          <>
            <IconBtn label="Edit" icon={IoCreateOutline} onClick={() => onEdit(v.id)} disabled={busyAny} />
            <IconBtn label="Publish" icon={IoCloudUploadOutline} onClick={() => publish.trigger({})} disabled={busyAny} tone="teal" />
            <IconBtn label="Delete" icon={IoTrashOutline} onClick={() => remove.trigger({})} disabled={busyAny} tone="red" />
          </>
        )}
        {v.status !== 'draft' && (
          <IconBtn label="New version from this" icon={IoDuplicateOutline} onClick={() => onCloneFrom(v.id)} disabled={busyAny} />
        )}
        {v.status === 'published' && (
          <IconBtn label="Archive" icon={IoArchiveOutline} onClick={() => archive.trigger({})} disabled={busyAny} />
        )}
      </div>
    </div>
  )
}

function IconBtn({ label, icon: Icon, onClick, disabled, tone = 'slate' }: {
  label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; disabled?: boolean; tone?: 'slate' | 'teal' | 'red'
}) {
  const tones = {
    slate: 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700',
    teal: 'text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30',
    red: 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30',
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={cn('rounded-sm p-2 transition-colors disabled:opacity-40', tones[tone])}>
      <Icon className="size-4" />
    </button>
  )
}
