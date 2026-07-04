'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IoWarningOutline,
  IoChevronDownOutline,
  IoChevronForwardOutline,
  IoReorderThreeOutline,
  IoAddOutline,
  IoPricetagOutline,
  IoArrowUpOutline,
  IoArrowDownOutline,
} from 'react-icons/io5'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { useCan } from '@/lib/rbac/use-can'
import { toast } from '@/lib/store/toast-store'
import { cn } from '@/lib/utils'
import {
  categoriesApi,
  flattenCategories,
  bandLabel,
  displayRate,
  type AdminCategory,
  type ReorderItem,
} from '@/lib/api/categories'
import { CategoryEditDrawer } from './CategoryEditDrawer'

type Filter = 'all' | 'active' | 'hidden' | 'needs_band'

const FILTER_OPTIONS = [
  { value: 'all',        label: 'All' },
  { value: 'active',     label: 'Active' },
  { value: 'hidden',     label: 'Hidden' },
  { value: 'needs_band', label: 'Needs a band' },
]

export function CategoriesManager() {
  const canManage  = useCan('categories.manage')
  const canSetBand = useCan('categories.set_band')
  const queryClient = useQueryClient()

  const [search,      setSearch]      = useState('')
  const [filter,      setFilter]      = useState<Filter>('all')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editing,     setEditing]     = useState<AdminCategory | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => categoriesApi.list(),
  })

  const allCategories: AdminCategory[] = data?.data ?? []

  const bandlessCount = useMemo(
    () =>
      allCategories.reduce((n, p) => {
        const missing = !p.commission_band ? 1 : 0
        const childMissing = p.children.filter((c) => !c.commission_band).length
        return n + missing + childMissing
      }, 0),
    [allCategories],
  )

  const filteredParents = useMemo(() => {
    let list = allCategories
    if (filter === 'active')     list = list.filter((c) => c.is_active)
    if (filter === 'hidden')     list = list.filter((c) => !c.is_active)
    if (filter === 'needs_band') list = list.filter(
      (c) => !c.commission_band || c.children.some((ch) => !ch.commission_band),
    )
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.children.some((ch) => ch.name.toLowerCase().includes(q)),
      )
    }
    return list
  }, [allCategories, filter, search])

  const rows = useMemo(
    () => flattenCategories(filteredParents, expandedIds),
    [filteredParents, expandedIds],
  )

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openCreate() {
    setEditing(null)
    setDrawerOpen(true)
  }

  function openEdit(cat: AdminCategory) {
    setEditing(cat)
    setDrawerOpen(true)
  }

  function onDrawerClose() {
    setDrawerOpen(false)
    setEditing(null)
  }

  function onSaved() {
    queryClient.invalidateQueries({ queryKey: ['admin-categories'] })
    onDrawerClose()
  }

  const toggleMutation = useAuditedMutation<{ id: number; is_active: boolean }, unknown>({
    mutationFn: ({ id, is_active, reason }) =>
      categoriesApi.update(id, { is_active, reason }),
    audit: {
      action: 'category.toggle_status',
      targetType: 'category',
      targetId: '',
      summary: 'Toggle category active / hidden status.',
    },
    capability: 'categories.manage',
    onSuccess: () => {
      toast.success('Status updated.')
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] })
    },
  })

  const reorderMutation = useAuditedMutation({
    mutationFn: ({ items, reason }: { items: ReorderItem[]; reason: string }) =>
      categoriesApi.reorder(items, reason),
    audit: {
      action: 'category.reorder',
      targetType: 'category',
      targetId: 'bulk',
      summary: 'Reorder categories.',
    },
    capability: 'categories.manage',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] })
    },
  })

  const deleteMutation = useAuditedMutation<{ id: number }, unknown>({
    mutationFn: ({ id, reason }) =>
      categoriesApi.delete(id, { reason }),
    audit: {
      action: 'category.delete',
      targetType: 'category',
      targetId: '',
      summary: 'Delete a category permanently.',
    },
    capability: 'categories.manage',
    onSuccess: () => {
      toast.success('Category deleted.')
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] })
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Cannot delete this category.'
      toast.error(msg)
    },
  })

  const moveCategory = useCallback(
    (cat: AdminCategory & { depth: number }, direction: 'up' | 'down') => {
      // Get the sibling list at the same depth within filteredParents.
      const siblings: AdminCategory[] =
        cat.depth === 0
          ? filteredParents
          : (filteredParents.find((p) => p.id === cat.parent_id)?.children ?? [])

      const idx = siblings.findIndex((s) => s.id === cat.id)
      if (idx < 0) return
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1
      if (targetIdx < 0 || targetIdx >= siblings.length) return

      // Swap display_orders
      const items: ReorderItem[] = [
        { id: siblings[idx].id,       display_order: siblings[targetIdx].display_order },
        { id: siblings[targetIdx].id, display_order: siblings[idx].display_order },
      ]

      reorderMutation.trigger({ items, reason: `Moved "${cat.name}" ${direction}.` })
    },
    [filteredParents, reorderMutation],
  )

  if (!canManage) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Categories</h1>
        <EmptyState title="Access denied" description="You do not have permission to manage categories." icon={IoPricetagOutline} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
            <IoPricetagOutline className="size-5 text-teal-600" />
            Categories
            {!isLoading && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {allCategories.length}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Hierarchical service categories with commission band assignments.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-sm bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 min-h-[44px]"
          aria-label="Add category"
        >
          <IoAddOutline className="size-4" />
          Add category
        </button>
      </div>

      {/* Band-less warning banner — non-dismissable while gap exists */}
      {!isLoading && bandlessCount > 0 && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-3 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"
        >
          <IoWarningOutline className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="text-amber-800 dark:text-amber-300">
            <strong>{bandlessCount} {bandlessCount === 1 ? 'category has' : 'categories have'} no commission band</strong>
            {' '}— set before they can record revenue.{' '}
            <button
              type="button"
              className="underline hover:no-underline"
              onClick={() => setFilter('needs_band')}
            >
              View affected categories
            </button>
          </span>
        </div>
      )}

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={(v) => setSearch(v)}
        searchPlaceholder="Search categories…"
        filters={[
          {
            key: 'status',
            label: 'All',
            value: filter,
            options: FILTER_OPTIONS,
            onChange: (v) => setFilter((v as Filter) || 'all'),
          },
        ]}
      />

      {/* Tree table */}
      <div className="overflow-x-auto rounded-sm border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <table className="w-full min-w-full text-sm" aria-label="Categories tree">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="w-10 px-2 py-3" aria-label="Reorder" />
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400">Category</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400">Commission band</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400">Status</th>
              <th className="w-16 px-4 py-3" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  {[0, 1, 2, 3, 4].map((ci) => (
                    <td key={ci} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12">
                  <EmptyState
                    title={filter === 'needs_band' ? 'All categories have a commission band' : 'No categories found'}
                    description={filter === 'needs_band' ? 'Great — no revenue gaps.' : 'Add a category to get started.'}
                    icon={IoPricetagOutline}
                  />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <CategoryRow
                  key={row.id}
                  row={row}
                  canSetBand={canSetBand}
                  isExpanded={expandedIds.has(row.id)}
                  onToggleExpand={toggleExpand}
                  onMoveUp={() => moveCategory(row, 'up')}
                  onMoveDown={() => moveCategory(row, 'down')}
                  onEdit={() => openEdit(row)}
                  onToggleStatus={() => toggleMutation.trigger({ id: row.id, is_active: !row.is_active })}
                  onDelete={() => deleteMutation.trigger({ id: row.id })}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <CategoryEditDrawer
        open={drawerOpen}
        category={editing}
        allCategories={allCategories}
        canSetBand={canSetBand}
        onClose={onDrawerClose}
        onSaved={onSaved}
      />
    </div>
  )
}

// ── Individual row ──────────────────────────────────────────

interface RowProps {
  row: AdminCategory & { depth: number; childCount: number }
  canSetBand: boolean
  isExpanded: boolean
  onToggleExpand: (id: number) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onToggleStatus: () => void
  onDelete: () => void
}

function CategoryRow({
  row,
  isExpanded,
  onToggleExpand,
  onMoveUp,
  onMoveDown,
  onEdit,
  onToggleStatus,
}: RowProps) {
  const rate = displayRate(row)
  const band = row.commission_band

  return (
    <tr
      className={cn(
        'border-b border-slate-100 last:border-0 transition-colors',
        'hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-700/30',
        row.depth === 1 && 'bg-slate-50/50 dark:bg-slate-800/20',
      )}
    >
      {/* Reorder handle + arrows */}
      <td className="w-10 px-2 py-3">
        <div className="flex flex-col items-center gap-0.5">
          <IoReorderThreeOutline className="size-3.5 text-slate-300 dark:text-slate-600" aria-hidden="true" />
          <button
            type="button"
            onClick={onMoveUp}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 min-h-[22px] min-w-[22px] flex items-center justify-center"
            aria-label={`Move "${row.name}" up`}
          >
            <IoArrowUpOutline className="size-3" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 min-h-[22px] min-w-[22px] flex items-center justify-center"
            aria-label={`Move "${row.name}" down`}
          >
            <IoArrowDownOutline className="size-3" />
          </button>
        </div>
      </td>

      {/* Name + hierarchy hint */}
      <td className="px-4 py-3">
        <div
          className="flex items-center gap-2"
          style={{ paddingLeft: row.depth === 1 ? '1.25rem' : undefined }}
        >
          {row.depth === 0 && row.childCount > 0 && (
            <button
              type="button"
              onClick={() => onToggleExpand(row.id)}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 min-h-[24px] min-w-[24px] flex items-center justify-center"
              aria-label={isExpanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
              aria-expanded={isExpanded}
            >
              {isExpanded ? (
                <IoChevronDownOutline className="size-3.5" />
              ) : (
                <IoChevronForwardOutline className="size-3.5" />
              )}
            </button>
          )}
          {row.depth === 0 && row.childCount === 0 && (
            <span className="size-5 shrink-0" aria-hidden="true" />
          )}

          {/* Icon: prefer icon_url (image), fall back to letter avatar */}
          {row.icon_url ? (
            <img
              src={row.icon_url}
              alt=""
              aria-hidden="true"
              className="size-6 shrink-0 rounded object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded bg-teal-50 text-[11px] font-semibold uppercase text-teal-600 dark:bg-teal-900/30 dark:text-teal-400"
            >
              {row.name.charAt(0)}
            </span>
          )}

          <div className="min-w-0">
            <span className="font-medium text-slate-800 dark:text-slate-200">{row.name}</span>
            {row.depth === 0 && row.childCount > 0 && (
              <span className="ml-1.5 text-xs text-slate-400">
                {row.childCount} {row.childCount === 1 ? 'sub' : 'subs'}
              </span>
            )}
            {row.depth === 1 && (
              <span className="ml-1.5 text-xs text-slate-400">sub-category</span>
            )}
          </div>
        </div>
      </td>

      {/* Commission band pill */}
      <td className="px-4 py-3">
        {band ? (
          <StatusPill
            label={rate ? `${bandLabel(band)} · ${rate}` : bandLabel(band)}
            variant="info"
          />
        ) : (
          <StatusPill label="Set band" variant="warning" />
        )}
      </td>

      {/* Status toggle */}
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onToggleStatus}
          aria-label={`${row.is_active ? 'Hide' : 'Activate'} "${row.name}"`}
          className="flex items-center gap-1.5 rounded-sm border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 min-h-[32px]"
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              row.is_active ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600',
            )}
            aria-hidden="true"
          />
          {row.is_active ? 'Active' : 'Hidden'}
        </button>
      </td>

      {/* Edit action */}
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-sm border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 min-h-[32px]"
          aria-label={`Edit "${row.name}"`}
        >
          Edit
        </button>
      </td>
    </tr>
  )
}
