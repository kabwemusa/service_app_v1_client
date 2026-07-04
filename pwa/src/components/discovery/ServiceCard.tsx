import { Link } from 'react-router-dom';
import type { SearchResult } from '../../api/search';
import { storageUrl } from '../../api/client';
import { categoryImage, categoryColor } from '../../theme/imagery';
import './discovery.css';

// Web twin of the mobile ServiceDiscoveryCard: photo → service info → provider
// row → book button, flat with hairline dividers. Renders backend facts only —
// tier label + verified check, never the raw trust score, never coordinates.

function tierLabel(tier: number): string {
  if (tier >= 3) return 'Elite';
  if (tier === 2) return 'Trusted';
  return 'Verified';
}
function tierClass(tier: number): string {
  return tier >= 3 ? 'sc-tier-elite' : 'sc-tier-trusted';
}

function priceText(model: string, price: number | null): string {
  if (model === 'PROVIDER_SCOPE' || model === 'QUOTE_DEPOSIT' || price == null) return 'By quote';
  if (model === 'HOURLY_CAPPED') return `K${price}/hr`;
  return `K${price}`;
}

const isQuoteFirst = (m: string) => m === 'PROVIDER_SCOPE' || m === 'QUOTE_DEPOSIT';

export function ServiceCard({ result, onBook }: { result: SearchResult; onBook?: () => void }) {
  const { provider, category } = result;
  const photo = result.photo_urls?.[0] ? storageUrl(result.photo_urls[0]) : null;
  const fallbackImg = categoryImage(category?.name, category?.id ?? 0, 800);
  const accent = categoryColor(category?.id ?? 0);
  const initial = (provider?.display_name || '?')[0].toUpperCase();
  const jobs = result.completed_job_count ?? 0;
  const rating = provider?.v_reviews > 0 ? provider.r_bayes : null;

  return (
    <article className="sc-card">
      <Link to={`/service/${result.id}`} className="sc-link" aria-label={result.title}>
        {result.placement === 'promoted' && (
          <div className="sc-promoted"><span aria-hidden>⚡</span> Promoted</div>
        )}

        {/* Photo — real service photo when present, otherwise a category image. */}
        <div className="sc-photo-wrap">
          <img
            src={photo ?? fallbackImg}
            alt=""
            loading="lazy"
            className="sc-photo"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = fallbackImg; }}
          />
          {category?.name && (
            <span className="sc-cat-tag" style={{ background: accent }}>{category.name}</span>
          )}
        </div>

        <div className="sc-divider" />

        {/* Service info */}
        <div className="sc-info">
          <p className="sc-title">{result.title}</p>
          <div className="sc-meta">
            <span className="sc-price">{priceText(result.pricing_model, result.base_price)}</span>
            {rating != null && (
              <>
                <span className="sc-dot" aria-hidden />
                <span className="sc-star" aria-hidden>★</span>
                <span className="sc-meta-txt">{rating.toFixed(1)} ({provider.v_reviews})</span>
              </>
            )}
            {jobs > 0 && (
              <>
                <span className="sc-dot" aria-hidden />
                <span className="sc-meta-txt">{jobs >= 100 ? '100+' : jobs} job{jobs !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>
          {provider?.base_location_label && (
            <div className="sc-loc"><span aria-hidden>📍</span> {provider.base_location_label}</div>
          )}
        </div>

        <div className="sc-divider" />

        {/* Provider row */}
        <div className="sc-provider">
          <span className="sc-avatar">{initial}</span>
          <div className="sc-provider-body">
            <div className="sc-name-row">
              <span className="sc-name">{provider?.display_name}</span>
              {provider?.trust_tier >= 2 && <span className="sc-check" aria-label="Verified">✓</span>}
            </div>
            <span className={`sc-tier ${tierClass(provider?.trust_tier ?? 1)}`}>
              🛡 {tierLabel(provider?.trust_tier ?? 1)}
            </span>
          </div>
        </div>
      </Link>

      {onBook && (
        <>
          <div className="sc-divider" />
          <button className="sc-book" onClick={onBook}>
            {isQuoteFirst(result.pricing_model) ? 'Get a quote' : 'Book now'}
          </button>
        </>
      )}
    </article>
  );
}
