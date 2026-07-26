'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AdminCategory, categoriesApi } from '@/lib/api/categories'

// Reusable category picker (admin twin of the app/PWA component): an inline
// searchable combobox over the ONE shared taxonomy (name + synonyms + parent
// group), type-ahead + debounced, results capped so hundreds never render at
// once. Replaces fixed <select> chips that don't scale past ~10 categories.

interface FlatCategory {
  id: number
  name: string
  parent_id: number | null
  parent_name: string | null
  synonyms: string[]
}

function flatten(tree: AdminCategory[], parentName: string | null = null): FlatCategory[] {
  const out: FlatCategory[] = []
  for (const node of tree) {
    out.push({
      id: node.id,
      name: node.name,
      parent_id: node.parent_id,
      parent_name: parentName,
      synonyms: node.synonyms ?? [],
    })
    if (node.children?.length) out.push(...flatten(node.children, node.name))
  }
  return out
}

function matches(cat: FlatCategory, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (needle === '') return true
  if (cat.name.toLowerCase().includes(needle)) return true
  if (cat.parent_name?.toLowerCase().includes(needle)) return true
  return cat.synonyms.some((s) => s.toLowerCase().includes(needle))
}

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  /** Exclude a subtree (e.g. the category being edited) from parent options. */
  excludeId?: number
  allowNone?: boolean
  noneLabel?: string
  maxRows?: number
  placeholder?: string
}

export function CategoryPicker({
  value,
  onChange,
  excludeId,
  allowNone = false,
  noneLabel = 'None (top level)',
  maxRows = 50,
  placeholder = 'Search categories…',
}: Props) {
  const [tree, setTree] = useState<AdminCategory[]>([])
  const [raw, setRaw] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    categoriesApi.list().then((res) => setTree(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setQuery(raw), 200)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [raw])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const flat = useMemo(() => flatten(tree).filter((c) => c.id !== excludeId), [tree, excludeId])
  const selected = flat.find((c) => c.id === value) ?? null

  const { rows, total } = useMemo(() => {
    const all = flat.filter((c) => matches(c, query))
    return { rows: all.slice(0, maxRows), total: all.length }
  }, [flat, query, maxRows])

  const choose = (id: number | null) => {
    onChange(id)
    setRaw(''); setQuery(''); setOpen(false)
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      >
        <span className={selected ? '' : 'text-gray-400'}>
          {selected ? selected.name : allowNone ? noneLabel : 'Choose a category'}
        </span>
        <span aria-hidden className="text-gray-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900" role="listbox">
          <input
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={placeholder}
            aria-label="Search categories"
            className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-teal-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <ul className="mt-1 max-h-64 overflow-y-auto">
            {allowNone && (
              <li>
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${value === null ? 'text-teal-600' : 'text-gray-700 dark:text-gray-300'}`}
                >
                  {noneLabel}
                </button>
              </li>
            )}
            {rows.length === 0 ? (
              <li className="px-3 py-3 text-center text-sm text-gray-500">No categories match “{query}”.</li>
            ) : (
              rows.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.id === value}
                    onClick={() => choose(c.id)}
                    className={`flex w-full items-baseline gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${c.id === value ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40' : 'text-gray-900 dark:text-gray-100'}`}
                  >
                    <span>{c.name}</span>
                    {c.parent_name && <span className="text-xs text-gray-400">{c.parent_name}</span>}
                  </button>
                </li>
              ))
            )}
            {total > rows.length && (
              <li className="px-3 py-2 text-center text-xs text-gray-400">
                Showing {rows.length} of {total} — keep typing to narrow it down.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
