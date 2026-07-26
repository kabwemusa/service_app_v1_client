import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { catalogApi, type Category } from '../../api/catalog';
import { landingApi, type LandingSummary } from '../../api/landing';
import { searchApi, type SearchResult } from '../../api/search';
import { ServiceCard } from '../../components/discovery/ServiceCard';
import { Reveal, fadeUpItem, staggerContainer } from '../../components/ui/Motion';

// Client-routing <Link> that can also run Motion variants (used as a grid item
// so the card stays the grid cell — no extra wrapper that would break layout).
const MotionLink = motion.create(Link);
import { heroImage, categoryColor } from '../../theme/imagery';
import { useTheme } from '../../theme/useTheme';
import './landing.css';

// Marketing entry point ("/"). Everything shown is real platform data: the
// categories come from the catalog, the stats and reviews from /api/landing
// (reviews only exist for COMPLETED bookings, so they're all verified).
// Copy is deliberately English-only marketing prose for now.

const WA_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined)?.replace(/\D/g, '');

export function LandingScreen() {
  const { theme, toggle } = useTheme();
  const [cats, setCats] = useState<Category[]>([]);
  const [summary, setSummary] = useState<LandingSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [featured, setFeatured] = useState<SearchResult[]>([]);

  useEffect(() => {
    catalogApi.categories().then(setCats).catch(() => {});
    landingApi.summary()
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoadingSummary(false));
    // Real, backend-ranked services — same /search engine the app + browse use.
    searchApi.search({ sort: 'top_rated' }).then((r) => setFeatured(r.data.slice(0, 6))).catch(() => {});
  }, []);

  const reviews = summary?.reviews ?? [];
  const showReviews = loadingSummary || reviews.length > 0;

  return (
    <div className="ld">
      <Nav theme={theme} onToggleTheme={toggle} showReviews={showReviews} />
      <Hero cats={cats} summary={summary} />
      <CategoriesSection cats={cats} />
      {featured.length > 0 && <FeaturedSection results={featured} />}
      <HowItWorks />
      {showReviews && <ReviewsSection summary={summary} loading={loadingSummary} />}
      <ProviderBand />
      <TrustSection />
      <ChannelsSection />
      <FaqSection />
      <Footer />
    </div>
  );
}

/* ── Nav ─────────────────────────────────────────────────────────────────── */

function Nav({ theme, onToggleTheme, showReviews }: { theme: string; onToggleTheme: () => void; showReviews: boolean }) {
  return (
    <nav className="ld-nav">
      <div className="ld-container ld-nav-inner">
        <Link to="/" className="ld-logo" aria-label="Sebenza home">Sebenza<span>.</span></Link>
        <div className="ld-nav-links">
          <a className="ld-nav-link" href="#how-it-works">How it works</a>
          {showReviews && <a className="ld-nav-link" href="#reviews">Reviews</a>}
          <a className="ld-nav-link" href="#providers">For providers</a>
          <a className="ld-nav-link" href="#channels">Channels</a>
        </div>
        <div className="ld-nav-cta">
          <button className="ld-theme-toggle" aria-label="Toggle dark mode" onClick={onToggleTheme}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <Link to="/get-listed" className="ld-btn ld-btn-outline ld-btn-sm">Become a pro</Link>
          <Link to="/browse" className="ld-btn ld-btn-primary ld-btn-sm">Find a pro</Link>
        </div>
      </div>
    </nav>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero({ cats, summary }: { cats: Category[]; summary: LandingSummary | null }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const stats = summary?.stats;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/browse?q=${encodeURIComponent(q.trim())}` : '/browse');
  };

  return (
    <header className="ld-hero">
      <div className="ld-hero-aurora" aria-hidden />
      <div className="ld-container ld-hero-grid">
        <motion.div className="ld-hero-copy" variants={staggerContainer} initial="hidden" animate="show">
          <motion.span className="ld-hero-eyebrow" variants={fadeUpItem}><b>●</b> Zambia's trusted services marketplace</motion.span>
          <motion.h1 className="ld-h1" variants={fadeUpItem}>Find <em>trusted</em> local pros for every job.</motion.h1>
          <motion.p className="ld-hero-sub" variants={fadeUpItem}>
            Sebenza connects you with vetted, reviewed professionals near you — plumbers, electricians,
            cleaners, tutors and more. Agree the price upfront. Pay only when the job is done.
          </motion.p>

          <motion.form className="ld-search" onSubmit={submit} role="search" variants={fadeUpItem}>
            <IconSearch />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="What do you need done? Try “plumber”…"
              aria-label="Search services"
            />
            <button type="submit" className="ld-btn ld-btn-primary">Search</button>
          </motion.form>

          {cats.length > 0 && (
            <motion.div className="ld-chips" variants={fadeUpItem}>
              {cats.slice(0, 6).map((c) => (
                <Link key={c.id} to={`/browse?category_id=${c.id}`} className="ld-chip">{c.name}</Link>
              ))}
            </motion.div>
          )}

          {stats && (stats.providers > 0 || stats.jobs_done > 0) && (
            <motion.div className="ld-stats" variants={fadeUpItem}>
              {stats.providers > 0 && <Stat num={stats.providers.toLocaleString('en')} label="Vetted providers" />}
              {stats.jobs_done > 0 && <Stat num={stats.jobs_done.toLocaleString('en')} label="Jobs completed" />}
              {stats.avg_rating != null && (
                <Stat
                  num={<><IconStar /> {stats.avg_rating.toFixed(1)}</>}
                  label={`Average rating · ${stats.reviews.toLocaleString('en')} ${stats.reviews === 1 ? 'review' : 'reviews'}`}
                />
              )}
            </motion.div>
          )}
        </motion.div>

        {/* Marketing image (Unsplash) — desktop only, keeps the mobile hero tight. */}
        <motion.div
          className="ld-hero-media"
          aria-hidden
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <div className="ld-hero-editorial"><img src={heroImage} alt="" loading="eager" /></div>
          <div className="ld-hero-float ld-hero-request">
            <span className="ld-float-kicker">New request</span>
            <strong>Kitchen tap repair</strong>
            <span className="ld-float-meta"><i /> Matched with 3 trusted pros</span>
          </div>
          <div className="ld-hero-float ld-hero-provider">
            <span className="ld-provider-avatar">KM</span>
            <span><strong>Kaluba is available</strong><small><IconCheck size={13} /> ID verified · 4.9</small></span>
          </div>
          <span className="ld-hero-media-badge"><IconCheck size={15} /> Vetted &amp; reviewed pros</span>
        </motion.div>
      </div>
    </header>
  );
}

function Stat({ num, label }: { num: ReactNode; label: string }) {
  return (
    <div>
      <div className="ld-stat-num">{num}</div>
      <div className="ld-stat-label">{label}</div>
    </div>
  );
}

/* ── Categories ──────────────────────────────────────────────────────────── */

function CategoriesSection({ cats }: { cats: Category[] }) {
  if (cats.length === 0) return null;
  return (
    <section className="ld-section" id="categories">
      <div className="ld-container">
        <div className="ld-section-head-row">
          <div>
            <span className="ld-eyebrow">Browse</span>
            <h2 className="ld-h2">Whatever you need, someone near you does it.</h2>
            <p className="ld-section-sub">
              Search starts in your neighbourhood and widens to your city and province —
              you'll always find someone.
            </p>
          </div>
          <Link to="/browse" className="ld-btn ld-btn-outline">See all services</Link>
        </div>
        <motion.div
          className="ld-grid ld-grid-4"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '0px 0px -12% 0px' }}
        >
          {cats.slice(0, 12).map((c) => {
            const accent = categoryColor(c.id);
            return (
              <MotionLink
                key={c.id}
                to={`/browse?category_id=${c.id}`}
                className="ld-cat"
                variants={fadeUpItem}
                whileHover={{ y: -3 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              >
                <span
                  className="ld-cat-badge"
                  aria-hidden
                  style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent }}
                >
                  {c.name.charAt(0)}
                </span>
                {c.name}
                <span className="ld-cat-arrow" aria-hidden>›</span>
              </MotionLink>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

/* ── Featured services (real, backend-ranked) ────────────────────────────── */

function FeaturedSection({ results }: { results: SearchResult[] }) {
  return (
    <section className="ld-section ld-section-alt" id="featured">
      <div className="ld-container">
        <div className="ld-section-head-row">
          <div>
            <span className="ld-eyebrow">Popular now</span>
            <h2 className="ld-h2">Top-rated pros, ready to book.</h2>
            <p className="ld-section-sub">
              Real listings, ranked by our trust engine — the same order you'll see in the app.
            </p>
          </div>
          <Link to="/browse" className="ld-btn ld-btn-outline">Browse all</Link>
        </div>
        <Reveal className="ld-featured-grid">
          {results.map((r) => <ServiceCard key={r.id} result={r} />)}
        </Reveal>
      </div>
    </section>
  );
}

/* ── How it works (customers) ────────────────────────────────────────────── */

const CUSTOMER_STEPS = [
  { title: 'Say what you need', body: 'Search a service or describe the job in your own words — no account needed to browse.' },
  { title: 'Compare vetted pros', body: 'See verification badges, real ratings, and clear prices before you decide.' },
  { title: 'Book in minutes', body: 'Pick a time that suits you. Providers reply fast — most within 30 minutes.' },
  { title: "Pay when it's done", body: 'Pay your provider directly by mobile money or cash. Both of you confirm the job is complete.' },
];

function HowItWorks() {
  return <JourneySection />;

  return (
    <section className="ld-section ld-section-alt" id="how-it-works">
      <div className="ld-container">
        <span className="ld-eyebrow">For customers</span>
        <h2 className="ld-h2">From “I need help” to “job done” in four steps.</h2>
        <p className="ld-section-sub">No call-out lotteries, no guessing who's legit. Just vetted people and clear prices.</p>
        <div className="ld-grid ld-grid-4">
          {CUSTOMER_STEPS.map((s, i) => (
            <div key={s.title} className="ld-card">
              <span className="ld-step-num" aria-hidden>{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Reviews ─────────────────────────────────────────────────────────────── */

function ReviewsSection({ summary, loading }: { summary: LandingSummary | null; loading: boolean }) {
  const reviews = summary?.reviews ?? [];
  return (
    <section className="ld-section" id="reviews">
      <div className="ld-container">
        <span className="ld-eyebrow">Real reviews</span>
        <h2 className="ld-h2">Rated by real customers, on real jobs.</h2>
        <p className="ld-section-sub">
          Every review below comes from a verified completed booking — no paid testimonials, no cherry-picking.
        </p>
      </div>
      <div className="ld-container">
        <div className="ld-reviews">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 220 }} />)
            : reviews.map((r) => (
                <article key={r.id} className="ld-review">
                  <span className="ld-stars" aria-label={`${r.rating} out of 5 stars`}>{stars(r.rating)}</span>
                  <p className="ld-review-comment">“{r.comment}”</p>
                  <div className="ld-review-meta">
                    <span className="ld-review-avatar" aria-hidden>{r.reviewer.charAt(0)}</span>
                    <div>
                      <div className="t-label">{r.reviewer}</div>
                      <div className="t-small t-muted">
                        {r.service ? `${r.service} · ` : ''}{monthYear(r.created_at)}
                      </div>
                    </div>
                  </div>
                  <span className="ld-verified"><IconCheck size={14} /> Verified completed booking</span>
                </article>
              ))}
        </div>
      </div>
    </section>
  );
}

function stars(rating: number): string {
  const full = Math.round(Math.min(5, Math.max(0, rating)));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function monthYear(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en', { month: 'short', year: 'numeric' });
}

/* ── Provider band ───────────────────────────────────────────────────────── */

const PROVIDER_STEPS = [
  { title: 'Create your listing', body: 'Your name, your service, your price — done from your phone in about 10 minutes.' },
  { title: 'Verify your identity', body: 'NRC + selfie earns your Verified badge. Add police clearance to climb higher tiers.' },
  { title: 'Get booking requests', body: 'Customers nearby find you. Reply in the app or on WhatsApp — fast replies win jobs.' },
  { title: 'Get paid & grow', body: 'Customers pay you directly. Great reviews push you up the rankings.' },
];

const PROVIDER_PERKS = ['Free to get listed', 'You set your prices', 'Work your own hours', 'Verified badge builds trust'];

type JourneyAudience = 'customer' | 'provider';

function JourneySection() {
  const [audience, setAudience] = useState<JourneyAudience>('customer');
  const [activeStep, setActiveStep] = useState(0);
  const steps = audience === 'customer' ? CUSTOMER_STEPS : PROVIDER_STEPS;
  const headings = audience === 'customer'
    ? { eyebrow: 'Customer journey', title: 'A clearer way to get a job done.', body: 'Tell us what you need, see who is trusted, then book with confidence.' }
    : { eyebrow: 'Provider journey', title: 'Your work, made easier to find.', body: 'Build trust once, respond to the right work, and turn great service into growth.' };

  const chooseAudience = (next: JourneyAudience) => {
    setAudience(next);
    setActiveStep(0);
  };

  return (
    <section className="ld-section ld-journey" id="how-it-works">
      <div className="ld-container">
        <div className="ld-journey-top">
          <div>
            <span className="ld-eyebrow">{headings.eyebrow}</span>
            <h2 className="ld-h2">{headings.title}</h2>
            <p className="ld-section-sub">{headings.body}</p>
          </div>
          <div className="ld-journey-toggle" role="tablist" aria-label="Choose a journey">
            <button type="button" role="tab" aria-selected={audience === 'customer'} className={audience === 'customer' ? 'is-active' : ''} onClick={() => chooseAudience('customer')}>I need a service</button>
            <button type="button" role="tab" aria-selected={audience === 'provider'} className={audience === 'provider' ? 'is-active' : ''} onClick={() => chooseAudience('provider')}>I provide a service</button>
          </div>
        </div>
        <div className="ld-journey-layout">
          <div className="ld-journey-steps" aria-label={`${audience} journey steps`}>
            {steps.map((step, index) => (
              <button type="button" key={step.title} className={`ld-journey-step ${index === activeStep ? 'is-active' : ''}`} onClick={() => setActiveStep(index)}>
                <span className="ld-journey-number">0{index + 1}</span>
                <span><strong>{step.title}</strong><small>{step.body}</small></span>
                <span className="ld-journey-arrow" aria-hidden>↗</span>
              </button>
            ))}
          </div>
          <JourneyPreview audience={audience} step={steps[activeStep]} activeStep={activeStep} />
        </div>
      </div>
    </section>
  );
}

function JourneyPreview({ audience, step, activeStep }: { audience: JourneyAudience; step: { title: string; body: string }; activeStep: number }) {
  const status = audience === 'customer'
    ? ['Looking nearby', '3 pros matched', 'Booking sent', 'Job complete'][activeStep]
    : ['Profile draft', 'Identity checked', 'New nearby request', 'Review received'][activeStep];
  return (
    <div className="ld-journey-preview">
      <div className="ld-preview-orbit ld-preview-orbit-one" />
      <div className="ld-preview-orbit ld-preview-orbit-two" />
      <div className="ld-phone">
        <div className="ld-phone-notch" />
        <div className="ld-phone-screen">
          <div className="ld-phone-top"><span className="ld-logo">S<span>.</span></span><span className="ld-phone-signal" /></div>
          <div className="ld-phone-greeting">{audience === 'customer' ? 'Hello, Chipo' : 'Hello, Kaluba'}</div>
          <div className="ld-phone-status"><i /> {status}</div>
          <div className="ld-phone-job"><span className="ld-phone-job-icon">{audience === 'customer' ? '⌁' : '✓'}</span><div><strong>{step.title}</strong><small>{audience === 'customer' ? 'Home service · near you' : 'Sebenza provider hub'}</small></div></div>
          <div className="ld-phone-lines"><span /><span /><span /></div>
          <div className="ld-phone-action">{audience === 'customer' ? 'View trusted pros' : 'Open request'} <b>→</b></div>
        </div>
      </div>
      <div className="ld-preview-caption"><span>Live journey</span><strong>Step {activeStep + 1} of 4</strong></div>
    </div>
  );
}

function ProviderBand() {
  return (
    <section className="ld-band" id="providers">
      <div className="ld-container">
        <span className="ld-eyebrow">For providers</span>
        <h2 className="ld-h2">Turn your skill into steady work.</h2>
        <p className="ld-section-sub">
          Plumber, tailor, tutor, mechanic — if you're good at it, Sebenza brings the customers to you.
        </p>
        <div className="ld-band-perks">
          {PROVIDER_PERKS.map((p) => (
            <span key={p} className="ld-band-perk"><IconCheck size={16} /> {p}</span>
          ))}
        </div>
        <Link to="/get-listed" className="ld-btn ld-btn-inverse">Get listed — it's free</Link>
        <Reveal className="ld-grid ld-grid-4">
          {PROVIDER_STEPS.map((s, i) => (
            <div key={s.title} className="ld-card">
              <span className="ld-step-num" aria-hidden>{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ── Trust & safety ──────────────────────────────────────────────────────── */

function TrustSection() {
  return (
    <section className="ld-section">
      <div className="ld-container">
        <span className="ld-eyebrow">Trust &amp; safety</span>
        <h2 className="ld-h2">Vetted people. Honest reviews.</h2>
        <Reveal className="ld-grid ld-grid-3">
          <div className="ld-card">
            <span className="ld-icon-badge"><IconShield /></span>
            <h3>Identity verified</h3>
            <p>Every listed provider passes an NRC + selfie identity check before they can take a single booking.</p>
          </div>
          <div className="ld-card">
            <span className="ld-icon-badge"><IconBadge /></span>
            <h3>Trust tiers you can see</h3>
            <p>Badges show exactly how far a provider's vetting goes — from ID checks up to police clearance.</p>
          </div>
          <div className="ld-card">
            <span className="ld-icon-badge"><IconCheck size={22} /></span>
            <h3>Reviews from completed jobs only</h3>
            <p>You can only review a booking you actually finished — and our moderators remove anything fishy.</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Channels ────────────────────────────────────────────────────────────── */

function ChannelsSection() {
  return (
    <section className="ld-section ld-section-alt" id="channels">
      <div className="ld-container">
        <span className="ld-eyebrow">Channels</span>
        <h2 className="ld-h2">Book or work — the way that suits you.</h2>
        <p className="ld-section-sub">Low-data by design. Whatever phone you have, Sebenza works.</p>
        <Reveal className="ld-grid ld-grid-3">
          <div className="ld-card ld-channel">
            <span className="ld-icon-badge"><IconGlobe /></span>
            <h3>Web app<span className="ld-channel-tag">Live</span></h3>
            <p>Browse, book and manage jobs right here. Installable to your home screen, fast, and light on data.</p>
            <Link to="/browse" className="ld-btn ld-btn-outline ld-btn-sm">Open the web app</Link>
          </div>
          <div className="ld-card ld-channel">
            <span className="ld-icon-badge"><IconChat /></span>
            <h3>WhatsApp<span className="ld-channel-tag">Live</span></h3>
            <p>Book a pro — or run your whole provider business — inside a WhatsApp chat. No app, no downloads.</p>
            {WA_NUMBER && (
              <a
                href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hi Sebenza')}`}
                target="_blank"
                rel="noreferrer"
                className="ld-btn ld-btn-outline ld-btn-sm"
              >
                Chat on WhatsApp
              </a>
            )}
          </div>
          <div className="ld-card ld-channel">
            <span className="ld-icon-badge"><IconPhone /></span>
            <h3>Mobile app<span className="ld-channel-tag">Rolling out</span></h3>
            <p>Our full Android experience for customers and providers — richer notifications, offline-friendly.</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── FAQ ─────────────────────────────────────────────────────────────────── */

const FAQS = [
  {
    q: 'What does Sebenza cost?',
    a: 'Browsing and booking are free for customers, and providers list for free too. You agree the price with your provider before any work starts — no hidden fees.',
  },
  {
    q: 'How do payments work?',
    a: "You pay your provider directly — mobile money or cash — once the job is done. Both sides then mark the job complete in the app, so there's always a record.",
  },
  {
    q: 'How are providers vetted?',
    a: 'Every provider verifies their identity with an NRC and selfie before going live. Extra checks like police clearance earn higher trust tiers, shown as badges on their profile.',
  },
  {
    q: 'What if something goes wrong?',
    a: 'Every booking has a paper trail. You can raise a dispute or a safety report straight from the booking screen, and our team steps in.',
  },
  {
    q: 'Where does Sebenza work?',
    a: "We're live across Zambia. Search starts in your area and widens to your city and province, so you always find someone — even outside the big towns.",
  },
];

function FaqSection() {
  return (
    <section className="ld-section">
      <div className="ld-container">
        <span className="ld-eyebrow">FAQ</span>
        <h2 className="ld-h2">Good questions, straight answers.</h2>
        <Reveal className="ld-faq">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ── Footer ──────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="ld-footer">
      <div className="ld-container">
        <div className="ld-footer-grid">
          <div>
            <div className="ld-logo">Sebenza<span>.</span></div>
            <p className="t-small t-muted" style={{ marginTop: 8, maxWidth: 300 }}>
              Trusted local services across Zambia — vetted pros, honest reviews, prices agreed upfront.
            </p>
          </div>
          <div>
            <h4>Customers</h4>
            <div className="ld-footer-links">
              <Link to="/browse">Find a pro</Link>
              <a href="#how-it-works">How it works</a>
              <a href="#channels">Channels</a>
            </div>
          </div>
          <div>
            <h4>Providers</h4>
            <div className="ld-footer-links">
              <Link to="/get-listed">Get listed</Link>
              <a href="#providers">How it works for pros</a>
              {WA_NUMBER && (
                <a href={`https://wa.me/${WA_NUMBER}`} target="_blank" rel="noreferrer">WhatsApp us</a>
              )}
            </div>
          </div>
          <div>
            <h4>Legal</h4>
            <div className="ld-footer-links">
              <Link to="/legal/terms_of_service">Terms of Service</Link>
              <Link to="/legal/privacy_policy">Privacy Policy</Link>
              <Link to="/legal/user_agreement">User Agreement</Link>
              <Link to="/privacy">Privacy &amp; consent</Link>
            </div>
          </div>
        </div>
        <div className="ld-footer-bottom">
          <span>© {new Date().getFullYear()} Sebenza. Made in Zambia.</span>
          <span>English · Chinyanja · Bemba · Chitonga</span>
        </div>
      </div>
    </footer>
  );
}

/* ── Inline icons (no icon lib — keeps the bundle lean) ──────────────────── */

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z" />
    </svg>
  );
}

function IconCheck({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.5 4 5.5v6c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10v-6l-8-3z" /><path d="m9 12 2 2 4-4.5" />
    </svg>
  );
}

function IconBadge() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="9" r="6" /><path d="m8.5 14-.5 7.5 4-2.5 4 2.5-.5-7.5" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3 21l1.5-5.4A8.5 8.5 0 1 1 21 12z" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18" />
    </svg>
  );
}
