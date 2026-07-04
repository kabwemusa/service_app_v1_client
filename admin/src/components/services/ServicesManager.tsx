'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoBriefcaseOutline, IoWarningOutline, IoOpenOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { DetailPanel } from '@/components/ui/DetailPanel'
import { StatusPill } from '@/components/ui/StatusPill'
import { cn, fmtRelative, fmtZMW } from '@/lib/utils'
import {
  servicesApi,
  STATUS_LABEL,
  STATUS_VARIANT,
  PRICING_LABEL,
  flagLabel,
  type ServiceRow,
  type ServiceStatus,
  type ServiceFlag,
} from '@/lib/api/services'
import { ServiceDetail } from '@/components/services/ServiceDetail'
import { useAdminChannel } from '@/lib/realtime/useAdminChannel'
import { useQueueBadgeStore } from '@/lib/realtime/queue-badge-store'

type Tab = 'needs_review' | 'all'

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as ServiceStatus[]).map((v) => ({
  value: v,
  label: STATUS_LABEL[v],
}))

// Read/write the ?service= deep-link without useSearchParams (avoids forcing a
// Suspense boundary) — mirrors the Users module pattern. Other modules can link
// to /services?service=<id> or /services?provider=<id>.
function readParam(key: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(key)
}

function writeServiceParam(id: string | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('service', id)
  else url.searchParams.delete('service')
  window.history.replaceState(null, '', url.toString())
}

export function ServicesManager() {
  const [tab, setTab] = useState<Tab>('needs_review')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ServiceStatus | ''>('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [provider, setProvider] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Pick up deep-links on mount: ?service= opens a record; ?provider= filters the
  // catalogue to one provider's listings (from the Users module's Services tile).
  useEffect(() => {
    const svc = readParam('service')
    const prov = readParam('provider')
    if (svc) setSelectedId(svc)
    if (prov) {
      setProvider(prov)
      setTab('all')
    }
  }, [])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    writeServiceParam(id)
  }, [])

  const params = useMemo(
    () => ({
      tab,
      page,
      search,
      status: tab === 'all' ? status : '',
      provider,
      price_min: tab === 'all' ? priceMin : '',
      price_max: tab === 'all' ? priceMax : '',
    }),
    [tab, page, search, status, provider, priceMin, priceMax],
  )

  const { data, isLoading } = useQuery({
    queryKey: ['services', params],
    queryFn: () => servicesApi.list(params),
  })

  const queryClient = useQueryClient()
  const bumpBadge = useQueueBadgeStore((s) => s.increment)

  useAdminChannel('services', {
    'service.flagged': () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      bumpBadge('services')
    },
  })

  const switchTab = useCallback((t: Tab) => {
    setTab(t)
    setPage(1)
  }, [])

  const columns = useMemo<ColumnDef<ServiceRow>[]>(
    () => [
      {
        id: 'title',
        header: 'Listing',
        enableSorting: false,
        cell: ({ row }) => {
          const s = row.original
          return (
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800 dark:text-slate-200">{s.title}</p>
              <p className="text-xs text-slate-400">
                {PRICING_LABEL[s.pricing_model]}
                {s.base_price !== null && s.pricing_model !== 'QUOTE' && <> · {fmtZMW(s.base_price)}</>}
              </p>
            </div>
          )
        },
      },
      {
        id: 'provider',
        header: 'Provider',
        enableSorting: false,
        cell: ({ row }) => (
          // Links OUT to the Users record (their standing, prior actions).
          <Link
            href={`/users?user=${row.original.provider.id}`}
            className="inline-flex items-center gap-1 text-slate-600 hover:text-teal-600 hover:underline dark:text-slate-300 dark:hover:text-teal-400"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="max-w-32 truncate">{row.original.provider.name}</span>
            <IoOpenOutline className="size-3 shrink-0" aria-hidden="true" />
          </Link>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original.category
          if (!c) return <span className="text-amber-600 dark:text-amber-400">Uncategorised</span>
          return (
            <Link
              href={`/categories?category=${c.id}`}
              className="inline-flex items-center gap-1 text-slate-600 hover:text-teal-600 hover:underline dark:text-slate-300 dark:hover:text-teal-400"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="max-w-32 truncate">{c.name ?? 'Category'}</span>
              <IoOpenOutline className="size-3 shrink-0" aria-hidden="true" />
            </Link>
          )
        },
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        cell: ({ row }) => (
          <StatusPill label={STATUS_LABEL[row.original.status]} variant={STATUS_VARIANT[row.original.status]} />
        ),
      },
      {
        id: 'flags',
        header: 'Flags',
        enableSorting: false,
        cell: ({ row }) => <FlagCells flags={row.original.flags} />,
      },
      {
        id: 'age',
        header: 'Age',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
            {fmtRelative(row.original.created_at)}
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
            onClick={() => select(row.original.id)}
            className="rounded-sm border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label={`Review ${row.original.title}`}
          >
            Review
          </button>
        ),
      },
    ],
    [select],
  )

  function resetPageThen<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setPage(1)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
          <IoBriefcaseOutline className="size-5 text-teal-600" />
          Services
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Review provider listings for quality and policy. Flagged listings — image-pipeline hits,
          user reports, policy checks, and catalogue gaps — surface first.
        </p>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 border-b border-slate-200 dark:border-slate-700"
        role="tablist"
        aria-label="Service views"
      >
        <TabButton active={tab === 'needs_review'} onClick={() => switchTab('needs_review')}>
          Needs review
        </TabButton>
        <TabButton active={tab === 'all'} onClick={() => switchTab('all')}>
          All services
        </TabButton>
      </div>

      <FilterBar
        search={search}
        onSearchChange={resetPageThen(setSearch)}
        searchPlaceholder="Search by listing title or provider…"
        filters={
          tab === 'all'
            ? [
                {
                  key: 'status',
                  label: 'All statuses',
                  value: status,
                  options: STATUS_OPTIONS,
                  onChange: resetPageThen((v) => setStatus(v as ServiceStatus | '')),
                },
              ]
            : []
        }
        actions={
          tab === 'all' ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={priceMin}
                onChange={(e) => resetPageThen(setPriceMin)(e.target.value)}
                placeholder="Min ZMW"
                aria-label="Minimum price"
                className="h-9 w-24 rounded-sm border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <span className="text-slate-400">–</span>
              <input
                type="number"
                inputMode="numeric"
                value={priceMax}
                onChange={(e) => resetPageThen(setPriceMax)(e.target.value)}
                placeholder="Max ZMW"
                aria-label="Maximum price"
                className="h-9 w-24 rounded-sm border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          ) : undefined
        }
      />

      {/* Provider filter chip (from a Users deep-link) */}
      {provider && (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 font-medium text-teal-700 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-400">
            Filtered to one provider
            <button
              type="button"
              onClick={() => resetPageThen(setProvider)('')}
              className="hover:text-teal-900 dark:hover:text-teal-200"
              aria-label="Clear provider filter"
            >
              ✕
            </button>
          </span>
        </div>
      )}

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage={
          tab === 'needs_review'
            ? 'Nothing in the review queue — no flagged listings right now.'
            : 'No listings match these filters'
        }
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      <DetailPanel
        open={!!selectedId}
        onClose={() => select(null)}
        width="xl"
        title="Service review"
      >
        {selectedId && <ServiceDetail serviceId={selectedId} />}
      </DetailPanel>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-400'
          : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
      )}
    >
      {children}
    </button>
  )
}

// Flag reasons rendered as TEXT chips (not colour alone) for a11y.
function FlagCells({ flags }: { flags: ServiceFlag[] }) {
  if (flags.length === 0) {
    return <span className="text-slate-400">—</span>
  }
  // De-dupe reasons for the compact row view.
  const reasons = Array.from(new Set(flags.map((f) => f.reason)))
  const shown = reasons.slice(0, 2)
  const extra = reasons.length - shown.length

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((reason) => (
        <span
          key={reason}
          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
        >
          <IoWarningOutline className="size-2.5" aria-hidden="true" />
          {flagLabel(reason)}
        </span>
      ))}
      {extra > 0 && <span className="text-[11px] text-slate-400">+{extra}</span>}
    </div>
  )
}
