'use client'

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { IoChevronUpOutline, IoChevronDownOutline, IoSwapVerticalOutline, IoChevronBackOutline, IoChevronForwardOutline } from 'react-icons/io5'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/EmptyState'

interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  pageSize?: number
  isLoading?: boolean
  emptyMessage?: string
  className?: string
  // Server-side pagination
  totalRows?: number
  currentPage?: number
  onPageChange?: (page: number) => void
}

const SKELETON_ROWS = 5

export function DataTable<T>({
  data,
  columns,
  pageSize = 20,
  isLoading = false,
  emptyMessage = 'No records found.',
  className,
  totalRows,
  currentPage,
  onPageChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const serverPagination = totalRows !== undefined && onPageChange !== undefined

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(serverPagination ? {} : { getPaginationRowModel: getPaginationRowModel() }),
    initialState: { pagination: { pageSize } },
  })

  const page = serverPagination ? (currentPage ?? 1) : table.getState().pagination.pageIndex + 1
  const lastPage = serverPagination
    ? Math.ceil((totalRows ?? 0) / pageSize)
    : table.getPageCount()

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="overflow-x-auto rounded-sm border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <table className="w-full min-w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-slate-200 dark:border-slate-700">
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  return (
                    <th
                      key={header.id}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={cn(
                        'px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 select-none',
                        canSort && 'cursor-pointer hover:text-slate-700 dark:hover:text-slate-200',
                      )}
                    >
                      <span className="flex items-center gap-1">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          sorted === 'asc' ? <IoChevronUpOutline className="size-3" /> :
                          sorted === 'desc' ? <IoChevronDownOutline className="size-3" /> :
                          <IoSwapVerticalOutline className="size-3 text-slate-300" />
                        )}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  {columns.map((_, ci) => (
                    <td key={ci} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12">
                  <EmptyState title={emptyMessage} />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-700/30 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {lastPage > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Page {page} of {lastPage}</span>
          <div className="flex gap-1">
            <button
              onClick={() =>
                serverPagination ? onPageChange(page - 1) : table.previousPage()
              }
              disabled={page <= 1}
              className="rounded-sm border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-700"
              aria-label="Previous page"
            >
              <IoChevronBackOutline className="size-3.5" />
            </button>
            <button
              onClick={() =>
                serverPagination ? onPageChange(page + 1) : table.nextPage()
              }
              disabled={page >= lastPage}
              className="rounded-sm border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-700"
              aria-label="Next page"
            >
              <IoChevronForwardOutline className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
