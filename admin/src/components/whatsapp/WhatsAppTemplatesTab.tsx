'use client'

import { useQuery } from '@tanstack/react-query'
import { IoDocumentTextOutline, IoOpenOutline } from 'react-icons/io5'
import { Card } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { whatsappApi } from '@/lib/api/whatsapp'

export function WhatsAppTemplatesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-templates'],
    queryFn: () => whatsappApi.templates(),
  })

  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-sm border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        <p>
          Templates are registered and approved in Meta Business Manager. Approval status and send volume aren't
          mirrored here yet — this view shows the platform's registered template set, read-only.
        </p>
        <a
          href="https://business.facebook.com/wa/manage/message-templates/"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 font-medium text-teal-600 hover:underline dark:text-teal-400"
        >
          Open Meta Business Manager <IoOpenOutline className="size-3" />
        </a>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-sm bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No templates registered" icon={IoDocumentTextOutline} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((t) => (
            <Card key={t.name}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium text-slate-800 dark:text-slate-200">{t.name}</span>
                <StatusPill label={t.category} variant={t.category === 'MARKETING' ? 'warning' : 'neutral'} autoVariant={false} />
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t.body}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                Language: {t.language} · Params: {t.params.join(', ') || 'none'}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
