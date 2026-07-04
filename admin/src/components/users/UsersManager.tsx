'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoPeopleOutline, IoWarningOutline, IoStarOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { DetailPanel } from '@/components/ui/DetailPanel'
import { StatusPill } from '@/components/ui/StatusPill'
import { Avatar } from '@/components/ui/Avatar'
import { cn, fmtDate, fmtPercent } from '@/lib/utils'
import {
  usersApi,
  ROLE_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  TIER_LABEL,
  type UserRow,
  type UserRoleLabel,
  type AccountStatus,
} from '@/lib/api/users'
import { UserDetail } from '@/components/users/UserDetail'

const ROLE_OPTIONS = (Object.keys(ROLE_LABEL) as UserRoleLabel[])
  .filter((r) => r !== 'staff')
  .map((v) => ({ value: v, label: ROLE_LABEL[v] }))

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as AccountStatus[])
  .filter((s) => s !== 'pending_closure')
  .map((v) => ({ value: v, label: STATUS_LABEL[v] }))

const TIER_OPTIONS = ([0, 1, 2, 3, 4] as const).map((t) => ({
  value: String(t),
  label: `Tier ${t} · ${TIER_LABEL[t]}`,
}))

const FLAGGED_OPTIONS = [{ value: '1', label: 'Flagged only' }]

// Read/write the ?user= deep-link without pulling in useSearchParams (which would
// force a Suspense boundary). Other modules link to /users?user=<id>.
function readUserParam(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('user')
}

function writeUserParam(id: string | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('user', id)
  else url.searchParams.delete('user')
  window.history.replaceState(null, '', url.toString())
}

export function UsersManager() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<UserRoleLabel | ''>('')
  const [status, setStatus] = useState<AccountStatus | ''>('')
  const [tier, setTier] = useState<'' | '0' | '1' | '2' | '3' | '4'>('')
  const [flagged, setFlagged] = useState<'' | '1'>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Pick up a deep-link on mount.
  useEffect(() => {
    const id = readUserParam()
    if (id) setSelectedId(id)
  }, [])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    writeUserParam(id)
  }, [])

  const params = { page, search, role, status, tier, flagged }

  const { data, isLoading } = useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.list(params),
  })

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        id: 'user',
        header: 'Name',
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original
          return (
            <div className="flex items-center gap-2.5">
              {/* Initials only in the list — public, never the KYC selfie */}
              <Avatar name={u.display_name} size="sm" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-medium text-slate-800 dark:text-slate-200">
                    {u.display_name}
                  </p>
                  {u.flagged && (
                    <span
                      className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
                      title="Open reports or fraud signals"
                    >
                      <IoWarningOutline className="size-2.5" aria-hidden="true" />
                      Flagged
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{ROLE_LABEL[u.role]}</p>
              </div>
            </div>
          )
        },
      },
      {
        id: 'tier',
        header: 'Tier',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600 dark:text-slate-400">
            T{row.original.trust_tier} · {TIER_LABEL[row.original.trust_tier]}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Account',
        enableSorting: false,
        cell: ({ row }) => (
          <StatusPill
            label={STATUS_LABEL[row.original.account_status]}
            variant={STATUS_VARIANT[row.original.account_status]}
          />
        ),
      },
      {
        id: 'signal',
        header: 'Key signal',
        enableSorting: false,
        cell: ({ row }) => <SignalCell user={row.original} />,
      },
      {
        id: 'joined',
        header: 'Joined',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">
            {fmtDate(row.original.created_at)}
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
            aria-label={`View ${row.original.display_name}`}
          >
            View
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
          <IoPeopleOutline className="size-5 text-teal-600" />
          Users
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Customer and provider accounts. The central record other modules link into. Flagged
          accounts (open reports or fraud signals) surface first.
        </p>
      </div>

      <FilterBar
        search={search}
        onSearchChange={resetPageThen(setSearch)}
        searchPlaceholder="Search by name, phone, email or ID…"
        filters={[
          {
            key: 'role',
            label: 'All roles',
            value: role,
            options: ROLE_OPTIONS,
            onChange: resetPageThen((v) => setRole(v as UserRoleLabel | '')),
          },
          {
            key: 'status',
            label: 'All statuses',
            value: status,
            options: STATUS_OPTIONS,
            onChange: resetPageThen((v) => setStatus(v as AccountStatus | '')),
          },
          {
            key: 'tier',
            label: 'All tiers',
            value: tier,
            options: TIER_OPTIONS,
            onChange: resetPageThen((v) => setTier(v as '' | '0' | '1' | '2' | '3' | '4')),
          },
          {
            key: 'flagged',
            label: 'All accounts',
            value: flagged,
            options: FLAGGED_OPTIONS,
            onChange: resetPageThen((v) => setFlagged(v as '' | '1')),
          },
        ]}
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No users match these filters"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      <DetailPanel
        open={!!selectedId}
        onClose={() => select(null)}
        width="xl"
        title="User detail"
      >
        {selectedId && <UserDetail userId={selectedId} onChanged={() => { /* query invalidation handled inside */ }} />}
      </DetailPanel>
    </div>
  )
}

function SignalCell({ user }: { user: UserRow }) {
  if (user.rating !== null) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-slate-600 dark:text-slate-400">
        <IoStarOutline className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
        {user.rating.toFixed(2)}
        <span className="text-xs text-slate-400">({user.reviews_count})</span>
      </span>
    )
  }
  if (user.is_provider && user.cancellation_rate !== null) {
    return (
      <span
        className={cn(
          'whitespace-nowrap text-sm',
          user.cancellation_rate > 0.1 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400',
        )}
      >
        {fmtPercent(user.cancellation_rate)} cancelled
      </span>
    )
  }
  return <span className="text-slate-400">—</span>
}
