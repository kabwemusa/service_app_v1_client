'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Shield, AlertOctagon, AlertTriangle, Flag, Siren, Clock, RefreshCw,
} from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { DetailPanel } from '@/components/ui/DetailPanel'
import { StatusPill } from '@/components/ui/StatusPill'
import { cn, fmtRelative, fmtDatetime } from '@/lib/utils'
import {
  safetyApi,
  CATEGORY_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  type SafetyKind,
  type Severity,
  type TriageStatus,
  type SafetyCategory,
  type ReportRow,
  type EmergencyRow,
  type BookingRef,
} from '@/lib/api/safety'
import { SafetyDetail } from '@/components/safety/SafetyDetail'

const SEVERITY_OPTIONS = (['EMERGENCY', 'HIGH', 'STANDARD'] as Severity[]).map((v) => ({
  value: v,
  label: SEVERITY_LABEL[v],
}))
const STATUS_OPTIONS = (['new', 'investigating', 'resolved'] as TriageStatus[]).map((v) => ({
  value: v,
  label: STATUS_LABEL[v],
}))
const TYPE_OPTIONS = (Object.keys(CATEGORY_LABEL) as SafetyCategory[]).map((v) => ({
  value: v,
  label: CATEGORY_LABEL[v],
}))

// ── Selection deep-link: ?case=<kind>:<id> ──────────────────────────────────────
interface Selection { kind: SafetyKind; id: string }

function readCaseParam(): Selection | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('case')
  if (!raw) return null
  const [kind, id] = raw.split(':')
  if ((kind === 'report' || kind === 'emergency') && id) return { kind, id }
  return null
}

function writeCaseParam(sel: Selection | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (sel) url.searchParams.set('case', `${sel.kind}:${sel.id}`)
  else url.searchParams.delete('case')
  window.history.replaceState(null, '', url.toString())
}

export function SafetyManager() {
  const [page, setPage] = useState(1)
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [status, setStatus] = useState<TriageStatus | ''>('')
  const [type, setType] = useState<SafetyCategory | ''>('')
  const [selected, setSelected] = useState<Selection | null>(null)

  useEffect(() => {
    const sel = readCaseParam()
    if (sel) setSelected(sel)
  }, [])

  const select = useCallback((sel: Selection | null) => {
    setSelected(sel)
    writeCaseParam(sel)
  }, [])

  const params = { page, severity, status, type }

  // Emergencies need freshness — poll every 30s and surface the last-updated time.
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['safety-queue', params],
    queryFn: () => safetyApi.queue(params),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  function resetPageThen<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1) }
  }

  const columns = useMemo<ColumnDef<ReportRow>[]>(
    () => [
      {
        id: 'severity',
        header: 'Severity',
        enableSorting: false,
        cell: ({ row }) => <SeverityCell severity={row.original.severity} />,
      },
      {
        id: 'type',
        header: 'Type',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-700 dark:text-slate-300">
            {row.original.category_label}
          </span>
        ),
      },
      {
        id: 'parties',
        header: 'Reporter / reported',
        enableSorting: false,
        cell: ({ row }) => <PartiesCell reporter={row.original.reporter_masked} reported={row.original.reported_masked} />,
      },
      {
        id: 'booking',
        header: 'Booking',
        enableSorting: false,
        cell: ({ row }) => <BookingCell booking={row.original.booking} />,
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="space-y-1">
            <StatusPill label={STATUS_LABEL[row.original.status]} autoVariant />
            {row.original.assigned_admin_name && (
              <p className="text-[11px] text-slate-400">by {row.original.assigned_admin_name}</p>
            )}
          </div>
        ),
      },
      {
        id: 'age',
        header: 'Age',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">
            {fmtRelative(row.original.reported_at)}
          </span>
        ),
      },
      {
        id: 'action',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => select({ kind: 'report', id: row.original.id })}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label={`Open ${row.original.category_label} report`}
          >
            Open
          </button>
        ),
      },
    ],
    [select],
  )

  const emergencies = data?.emergencies ?? []
  const showEmergencies = emergencies.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
            <Shield className="size-5 text-teal-600" />
            Safety
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Triage safety reports and emergency events, severity-first. Reporter identity is
            confidential — names and contact are masked until you reveal them (revealing is logged).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
          {dataUpdatedAt > 0 && (
            <span className="hidden sm:inline" aria-live="polite">
              Updated {fmtRelative(new Date(dataUpdatedAt))}
            </span>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Refresh queue"
          >
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Emergency band — surfaced top, visually distinct, unmissable ── */}
      {showEmergencies && (
        <section aria-label="Active emergencies" className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
            <Siren className="size-4" aria-hidden="true" />
            {emergencies.length} active emergency{emergencies.length === 1 ? '' : ' events'} — respond now
          </h2>
          <div className="space-y-2">
            {emergencies.map((e) => (
              <EmergencyCard key={e.id} event={e} onOpen={() => select({ kind: 'emergency', id: e.id })} />
            ))}
          </div>
        </section>
      )}

      <FilterBar
        filters={[
          {
            key: 'severity',
            label: 'All severities',
            value: severity,
            options: SEVERITY_OPTIONS,
            onChange: resetPageThen((v) => setSeverity(v as Severity | '')),
          },
          {
            key: 'status',
            label: 'All statuses',
            value: status,
            options: STATUS_OPTIONS,
            onChange: resetPageThen((v) => setStatus(v as TriageStatus | '')),
          },
          {
            key: 'type',
            label: 'All types',
            value: type,
            options: TYPE_OPTIONS,
            onChange: resetPageThen((v) => setType(v as SafetyCategory | '')),
          },
        ]}
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage={severity === 'EMERGENCY' ? 'No emergency events match — see the band above' : 'No open reports'}
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      <DetailPanel
        open={!!selected}
        onClose={() => select(null)}
        width="xl"
        title={selected?.kind === 'emergency' ? 'Emergency event' : 'Safety report'}
        subtitle="Reporter identity confidential · access is logged"
      >
        {selected && (
          <SafetyDetail
            kind={selected.kind}
            id={selected.id}
            onChanged={() => refetch()}
          />
        )}
      </DetailPanel>
    </div>
  )
}

// ── Cells ───────────────────────────────────────────────────────────────────────

const SEVERITY_META: Record<Severity, { icon: typeof Flag; cls: string; label: string }> = {
  EMERGENCY: { icon: AlertOctagon, cls: 'text-red-600 dark:text-red-400', label: SEVERITY_LABEL.EMERGENCY },
  HIGH: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400', label: SEVERITY_LABEL.HIGH },
  STANDARD: { icon: Flag, cls: 'text-slate-500 dark:text-slate-400', label: SEVERITY_LABEL.STANDARD },
}

// Severity is conveyed by TEXT + ICON, never colour alone (a11y).
function SeverityCell({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity]
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium', m.cls)}>
      <m.icon className="size-4" aria-hidden="true" />
      {m.label}
    </span>
  )
}

function PartiesCell({ reporter, reported }: { reporter: string | null; reported: string | null }) {
  return (
    <div className="min-w-0 text-sm">
      <p className="truncate text-slate-700 dark:text-slate-300">
        <span className="text-slate-400">R:</span>{' '}
        <span aria-label="reporter, masked">{reporter ?? '—'}</span>
      </p>
      <p className="truncate text-slate-500 dark:text-slate-400">
        <span className="text-slate-400">vs:</span>{' '}
        <span aria-label="reported, masked">{reported ?? '—'}</span>
      </p>
    </div>
  )
}

function BookingCell({ booking }: { booking: BookingRef | null }) {
  if (!booking) return <span className="text-slate-400">No booking</span>
  return <StatusPill label={booking.status} autoVariant />
}

// ── Emergency card (SLA timer ticks every second) ───────────────────────────────

function EmergencyCard({ event, onOpen }: { event: EmergencyRow; onOpen: () => void }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800/70 dark:bg-red-950/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <AlertOctagon className="size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-300">
              Emergency · {STATUS_LABEL[event.status]}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-700 dark:text-slate-300">
            <span className="text-slate-500 dark:text-slate-400">Buyer:</span> {event.reporter_masked ?? '—'}
            {event.reported_masked && (
              <> · <span className="text-slate-500 dark:text-slate-400">vs:</span> {event.reported_masked}</>
            )}
          </p>
          {event.location_label && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Near {event.location_label}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Triggered {fmtRelative(event.created_at)}
            </span>
            <SlaTimer dueAt={event.outreach_due_at} />
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
        >
          Respond
        </button>
      </div>
    </div>
  )
}

// §11.4 — 2-hour post-incident outreach SLA. Counts down; flips to "overdue".
function SlaTimer({ dueAt }: { dueAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!dueAt) return null
  const remaining = new Date(dueAt).getTime() - now
  const overdue = remaining <= 0
  const abs = Math.abs(remaining)
  const mins = Math.floor(abs / 60000)
  const secs = Math.floor((abs % 60000) / 1000)
  const clock = `${mins}:${String(secs).padStart(2, '0')}`

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular-nums',
        overdue
          ? 'bg-red-600 text-white'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      )}
      role="timer"
      aria-label={overdue ? `Outreach SLA overdue by ${clock}` : `Outreach SLA due in ${clock}`}
      title={`Outreach due ${fmtDatetime(dueAt)}`}
    >
      <Clock className="size-3" aria-hidden="true" />
      {overdue ? `SLA overdue ${clock}` : `SLA ${clock}`}
    </span>
  )
}
