import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { catalogApi, type Category } from '../../api/catalog';
import { searchApi, type SearchResult } from '../../api/search';
import { useLocationStore } from '../../store/locationStore';
import { useAuthStore } from '../../store/authStore';
import { usePendingAction } from '../../store/pendingActionStore';
import { ServiceCard } from '../../components/discovery/ServiceCard';
import { useTheme } from '../../theme/useTheme';

// Zero-wall browse: no account needed. Discovery goes through the SAME ranked
// /search engine the app uses — the PWA renders the backend's order verbatim and
// never sorts, scores, or geocodes itself.
export function BrowseScreen() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const requireAuth = usePendingAction((s) => s.requireAuth);
  const location = useLocationStore((s) => s.location);
  const resolveDevice = useLocationStore((s) => s.resolveDevice);
  const hydrate = useLocationStore((s) => s.hydrate);
  const fetchPrimary = useLocationStore((s) => s.fetchPrimary);

  const [cats, setCats] = useState<Category[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [fallback, setFallback] = useState(false);
  const [active, setActive] = useState<number | null>(() => {
    const id = Number(params.get('category_id'));
    return Number.isFinite(id) && id > 0 ? id : null;
  });
  const [q, setQ] = useState(params.get('q') ?? '');
  const [loading, setLoading] = useState(true);

  useEffect(() => { catalogApi.categories().then(setCats).catch(() => {}); }, []);
  useEffect(() => { hydrate(); fetchPrimary(); }, [hydrate, fetchPrimary]);

  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => {
      // Pass the resolved delivery location so the backend geo-ranks; it widens
      // by region tier server-side — we never compute distance or a radius here.
      searchApi.search({
        query: q || undefined,
        category_id: active ?? undefined,
        ...(location ? { lat: location.lat, lng: location.lng } : {}),
        ...(location?.region ? { region: location.region } : {}),
      })
        .then((r) => { setResults(r.data); setFallback(r.fallback); })
        .catch(() => { setResults([]); setFallback(false); })
        .finally(() => setLoading(false));
    }, q ? 300 : 0); // debounce search
    return () => clearTimeout(id);
  }, [active, q, location]);

  return (
    <div style={{ paddingBottom: 'var(--space-xl)' }}>
      <header style={{ padding: 'var(--space-md)', paddingTop: 'calc(var(--space-md) + env(safe-area-inset-top))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="t-h2">{t('browse.title')}</h1>
          <button aria-label="Toggle dark mode" onClick={toggle} style={{ width: 44, height: 44, border: 'none', background: 'transparent', fontSize: 18 }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <button
          onClick={() => { resolveDevice(); }}
          className="t-small t-muted"
          style={{ border: 'none', background: 'transparent', padding: 0, marginTop: 4 }}
        >
          📍 {location?.label ? t('browse.near', { area: location.label }) : t('browse.setLocation')}
        </button>
      </header>

      <div style={{ padding: '0 var(--space-md)' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('browse.searchPlaceholder')}
          style={{
            width: '100%', minHeight: 48, padding: '0 var(--space-md)',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text-primary)', fontSize: 16,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: 'var(--space-md)' }}>
        <Chip label="All" active={active === null} onClick={() => setActive(null)} />
        {cats.map((c) => <Chip key={c.id} label={c.name} active={active === c.id} onClick={() => setActive(c.id)} />)}
      </div>

      {fallback && !loading && results.length > 0 && (
        <p className="t-small t-muted" style={{ padding: '0 var(--space-md) var(--space-sm)' }}>
          {t('browse.fallbackNote')}
        </p>
      )}

      <div className="browse-grid" style={{ padding: '0 var(--space-md)' }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 'var(--radius-sm)' }} />)
          : results.length === 0
            ? <p className="t-muted" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 'var(--space-xl)' }}>{t('browse.noResults')}</p>
            : results.map((s) => (
                <ServiceCard
                  key={s.id}
                  result={s}
                  onBook={() => {
                    if (user) { navigate(`/book/${s.id}`); return; }
                    requireAuth({ kind: 'book', serviceId: s.id, label: t('common.almostThere') });
                  }}
                />
              ))}
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        whiteSpace: 'nowrap', minHeight: 36, padding: '0 var(--space-md)',
        borderRadius: 'var(--radius-full)', fontSize: 14, fontWeight: 600,
        border: '1px solid var(--border)',
        background: active ? 'var(--primary)' : 'var(--surface)',
        color: active ? '#fff' : 'var(--text-primary)',
      }}
    >
      {label}
    </button>
  );
}

// Renders backend-provided facts only: title, category, "from" price, the
// Promoted label when the backend placed the row, and a Verified marker for
// verified providers. Never the raw trust score, never coordinates.
