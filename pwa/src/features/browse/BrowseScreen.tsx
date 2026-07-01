import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { catalogApi, type Category, type ServiceCard } from '../../api/catalog';
import { Card } from '../../components/ui/ui';
import { useTheme } from '../../theme/useTheme';

// Zero-wall browse: no account needed to browse, search, or open detail.
export function BrowseScreen() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const [cats, setCats] = useState<Category[]>([]);
  const [services, setServices] = useState<ServiceCard[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const area = localStorage.getItem('area_label');

  useEffect(() => { catalogApi.categories().then(setCats).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => {
      catalogApi.services({ category_id: active ?? undefined, q: q || undefined })
        .then((r) => setServices(r.data))
        .catch(() => setServices([]))
        .finally(() => setLoading(false));
    }, q ? 300 : 0); // debounce search
    return () => clearTimeout(id);
  }, [active, q]);

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
          onClick={() => {
            navigator.geolocation?.getCurrentPosition(() => {
              localStorage.setItem('area_label', 'Lusaka');
              location.reload();
            });
          }}
          className="t-small t-muted"
          style={{ border: 'none', background: 'transparent', padding: 0, marginTop: 4 }}
        >
          📍 {area ? t('browse.near', { area }) : t('browse.setLocation')}
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', padding: '0 var(--space-md)' }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 88 }} />)
          : services.length === 0
            ? <p className="t-muted" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>{t('browse.noResults')}</p>
            : services.map((s) => <ServiceRow key={s.id} s={s} />)}
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

function ServiceRow({ s }: { s: ServiceCard }) {
  const { t } = useTranslation();
  const price = s.min_price ?? s.base_price;
  return (
    <Link to={`/service/${s.id}`}>
      <Card style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {s.photos?.[0]?.url
          ? <img src={s.photos[0].url} alt="" loading="lazy" style={{ width: 64, height: 64, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
          : <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-sm)', background: 'var(--primary-light)' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="t-label" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</p>
          {s.category && <p className="t-small t-muted">{s.category.name}</p>}
          {price != null && (
            <p className="t-small"><span className="t-muted">{t('browse.from')} </span><strong>K{price}</strong></p>
          )}
        </div>
        <span aria-hidden style={{ color: 'var(--text-secondary)' }}>›</span>
      </Card>
    </Link>
  );
}
