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
import './browse.css';

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
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => { catalogApi.categories().then(setCats).catch(() => {}); }, []);
  useEffect(() => { hydrate(); fetchPrimary(); }, [hydrate, fetchPrimary]);

  // First page — refetched whenever the filters/location change. Resets pagination.
  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => {
      // Pass the resolved delivery location so the backend geo-ranks; it widens
      // by region tier server-side — we never compute distance or a radius here.
      searchApi.search({
        query: q || undefined,
        category_id: active ?? undefined,
        page: 1,
        ...(location ? { lat: location.lat, lng: location.lng } : {}),
        ...(location?.region ? { region: location.region } : {}),
      })
        .then((r) => { setResults(r.data); setFallback(r.fallback); setPage(r.current_page); setLastPage(r.last_page); })
        .catch(() => { setResults([]); setFallback(false); setPage(1); setLastPage(1); })
        .finally(() => setLoading(false));
    }, q ? 300 : 0); // debounce search
    return () => clearTimeout(id);
  }, [active, q, location]);

  // Append the next page — the backend paginates /search; we render its order verbatim.
  const loadMore = () => {
    if (loadingMore || page >= lastPage) return;
    setLoadingMore(true);
    searchApi.search({
      query: q || undefined,
      category_id: active ?? undefined,
      page: page + 1,
      ...(location ? { lat: location.lat, lng: location.lng } : {}),
      ...(location?.region ? { region: location.region } : {}),
    })
      .then((r) => { setResults((prev) => [...prev, ...r.data]); setPage(r.current_page); setLastPage(r.last_page); })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="bz">
      <div className="bz-head">
        <div className="bz-head-row">
          <div>
            <h1 className="bz-title">{t('browse.title')}</h1>
            <p className="bz-sub">{t('browse.subtitle')}</p>
          </div>
          <button className="bz-icon-btn" aria-label="Toggle dark mode" onClick={toggle}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>

        <button className="bz-loc" onClick={() => { resolveDevice(); }}>
          <IconPin />
          {location?.label ? t('browse.near', { area: location.label }) : t('browse.setLocation')}
        </button>

        <div className="bz-search">
          <IconSearch />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('browse.searchPlaceholder')}
            aria-label={t('browse.searchPlaceholder')}
          />
        </div>
      </div>

      <div className="bz-chips">
        <button className={`bz-chip ${active === null ? 'is-active' : ''}`} onClick={() => setActive(null)}>All</button>
        {cats.map((c) => (
          <button key={c.id} className={`bz-chip ${active === c.id ? 'is-active' : ''}`} onClick={() => setActive(c.id)}>{c.name}</button>
        ))}
      </div>

      {fallback && !loading && results.length > 0 && (
        <p className="bz-meta">{t('browse.fallbackNote')}</p>
      )}

      <div className="browse-grid bz-grid">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 'var(--radius-sm)' }} />)
          : results.length === 0
            ? (
              <div className="bz-empty">
                <span className="bz-empty-emoji" aria-hidden>🔍</span>
                {t('browse.noResults')}
              </div>
            )
            : results.map((s, i) => (
                <ServiceCard
                  key={s.id}
                  result={s}
                  revealIndex={i}
                  onBook={() => {
                    if (user) { navigate(`/book/${s.id}`); return; }
                    requireAuth({ kind: 'book', serviceId: s.id, label: t('common.almostThere') });
                  }}
                />
              ))}
      </div>

      {!loading && results.length > 0 && page < lastPage && (
        <div className="bz-more-wrap">
          <button className="bz-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t('browse.loadingMore') : t('browse.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" /><circle cx="12" cy="11" r="2" />
    </svg>
  );
}

// Renders backend-provided facts only: title, category, "from" price, the
// Promoted label when the backend placed the row, and a Verified marker for
// verified providers. Never the raw trust score, never coordinates.
