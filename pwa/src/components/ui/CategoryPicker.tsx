import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Category,
  FlatCategory,
  catalogApi,
  flattenTaxonomy,
  matchesQuery,
} from '../../api/catalog';
import './category-picker.css';

/**
 * Reusable category picker — the same pattern as the app/admin:
 *   • a small set of POPULAR (most-used) categories as quick-tap chips, and
 *   • a SEARCHABLE combobox over the FULL taxonomy (name + synonyms + parent
 *     group), type-ahead + debounced, results capped/windowed for scale.
 *
 * The taxonomy is fetched from the ONE shared source (/categories) — never a
 * hardcoded list. Renders inline (desktop/web combobox).
 */
interface Props {
  selectedId: number | null;
  onSelect: (category: FlatCategory) => void;
  /** Cap the rendered result rows so hundreds of categories never render at once. */
  maxRows?: number;
  placeholder?: string;
}

export function CategoryPicker({ selectedId, onSelect, maxRows = 50, placeholder = 'Search categories…' }: Props) {
  const [tree, setTree] = useState<Category[]>([]);
  const [popular, setPopular] = useState<Category[]>([]);
  const [raw, setRaw] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([catalogApi.categories(), catalogApi.popularCategories()])
      .then(([all, pop]) => { setTree(all); setPopular(pop); })
      .catch(() => {});
  }, []);

  // Debounced type-ahead (250ms).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(raw), 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [raw]);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const flat = useMemo(() => flattenTaxonomy(tree), [tree]);
  const selected = flat.find((c) => c.id === selectedId) ?? null;

  const results = useMemo(() => {
    const all = flat.filter((c) => matchesQuery(c, query));
    return { rows: all.slice(0, maxRows), total: all.length };
  }, [flat, query, maxRows]);

  const choose = (c: FlatCategory) => {
    onSelect(c);
    setRaw(''); setQuery(''); setOpen(false);
  };

  return (
    <div className="cp" ref={boxRef}>
      <button
        type="button"
        className="cp-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? 'cp-trigger-val' : 'cp-trigger-placeholder'}>
          {selected ? selected.name : 'Choose a category'}
        </span>
        <span className="cp-caret" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="cp-pop" role="listbox">
          <input
            className="cp-search"
            type="text"
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={placeholder}
            aria-label="Search categories"
          />

          {query === '' && popular.length > 0 && (
            <div className="cp-popular">
              <span className="cp-section">Popular</span>
              <div className="cp-chips">
                {popular.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`cp-chip${c.id === selectedId ? ' cp-chip-on' : ''}`}
                    onClick={() => choose({ id: c.id, name: c.name, parent_id: c.parent_id ?? null, parent_name: null, synonyms: c.synonyms ?? [] })}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ul className="cp-list">
            {results.rows.length === 0 ? (
              <li className="cp-empty">No categories match “{query}”.</li>
            ) : (
              results.rows.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.id === selectedId}
                    className={`cp-row${c.id === selectedId ? ' cp-row-on' : ''}`}
                    onClick={() => choose(c)}
                  >
                    <span className="cp-row-name">{c.name}</span>
                    {c.parent_name && <span className="cp-row-parent">{c.parent_name}</span>}
                  </button>
                </li>
              ))
            )}
            {results.total > results.rows.length && (
              <li className="cp-more">Showing {results.rows.length} of {results.total} — keep typing to narrow it down.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
