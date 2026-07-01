import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { verificationApi, type VerificationStatus, type TierRow, type TierState } from '../../api/verification';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card, Button, Pill, Spinner, ProgressBar } from '../../components/ui/ui';

// Status home for the tier-upgrade surface. The ladder MIRRORS server eligibility
// — each row's state comes from the backend (ProviderVerification + gate), this
// screen never grants anything. Reached from Hub → Verification, onboarding's
// "do it later", or a category that needs a higher tier.
export function VerificationScreen() {
  const navigate = useNavigate();
  const [data, setData] = useState<VerificationStatus | null>(null);

  useEffect(() => { verificationApi.status().then(setData).catch(() => {}); }, []);

  if (!data) return <><ScreenHeader title="Verification & tiers" /><div style={{ display: 'grid', placeItems: 'center', height: '50vh' }}><Spinner /></div></>;

  return (
    <div>
      <ScreenHeader title="Verification & tiers" />
      <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <Card>
          <p className="t-small t-muted">Your current tier</p>
          <p className="t-h2">Tier {data.current_tier}</p>
          {data.pending_listings.length > 0 && (
            <p className="t-small" style={{ color: 'var(--warning)', marginTop: 6 }}>
              {data.pending_listings.length} listing{data.pending_listings.length > 1 ? 's' : ''} waiting on a higher tier to start getting jobs.
            </p>
          )}
        </Card>

        {data.pending_review && (
          <Card style={{ background: 'var(--primary-light)', border: 'none' }}>
            <p className="t-label">⏳ Under review</p>
            <p className="t-small" style={{ marginTop: 4 }}>
              We're checking your submission — usually 1–2 days. We'll let you know the moment it's done, and jobs start coming.
            </p>
          </Card>
        )}

        {data.tiers.map((row) => <TierCard key={row.tier} row={row} onAction={() => navigateForRow(navigate, row)} />)}
      </div>
    </div>
  );
}

function navigateForRow(navigate: ReturnType<typeof useNavigate>, row: TierRow) {
  if (row.verification_type === 'police_clearance') navigate('/verification/clearance');
  else if (row.verification_type === 'portfolio') navigate('/verification/portfolio');
}

// Distinct rendering per state — icon + text, never colour alone (a11y).
const STATE_META: Record<TierState, { icon: string; label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  DONE: { icon: '✓', label: 'Done', tone: 'success' },
  ADD: { icon: '＋', label: 'Add', tone: 'neutral' },
  UNDER_REVIEW: { icon: '⏳', label: 'Under review', tone: 'warning' },
  NEEDS_CHANGES: { icon: '↻', label: 'Needs changes', tone: 'warning' },
  EARNED: { icon: '★', label: 'Earned', tone: 'success' },
  EARNED_PROGRESS: { icon: '★', label: 'In progress', tone: 'neutral' },
};

function TierCard({ row, onAction }: { row: TierRow; onAction: () => void }) {
  const meta = STATE_META[row.state];
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p className="t-label">Tier {row.tier} · {row.label}</p>
          <p className="t-small t-muted" style={{ marginTop: 2 }}>Unlocks {row.unlocks}</p>
          {row.requirement && <p className="t-small" style={{ marginTop: 4 }}>{row.requirement}</p>}
        </div>
        <Pill tone={meta.tone}><span aria-hidden>{meta.icon}</span> {meta.label}</Pill>
      </div>

      {row.state === 'NEEDS_CHANGES' && row.reason && (
        <p className="t-small" style={{ color: 'var(--warning)', marginTop: 'var(--space-sm)' }}>{row.reason}</p>
      )}

      {row.kind === 'earned' && row.progress && <Tier4Progress p={row.progress} />}

      {(row.state === 'ADD' || row.state === 'NEEDS_CHANGES') && row.kind === 'upload' && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <Button variant={row.state === 'NEEDS_CHANGES' ? 'secondary' : 'primary'} onClick={onAction}>
            {row.state === 'NEEDS_CHANGES' ? 'Resubmit' : 'Add now'}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Tier4Progress({ p }: { p: NonNullable<TierRow['progress']> }) {
  return (
    <div style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <Metric label="Completed jobs" value={`${p.completed_jobs} / ${p.required_jobs}`} met={p.jobs_met} pct={Math.min(100, (p.completed_jobs / p.required_jobs) * 100)} />
      <Metric label="Average rating" value={p.avg_rating != null ? `${p.avg_rating} / ${p.required_rating}` : `— / ${p.required_rating}`} met={p.rating_met} pct={p.avg_rating ? Math.min(100, (p.avg_rating / 5) * 100) : 0} />
      <Metric label="Upheld disputes" value={`${p.upheld_disputes}`} met={p.disputes_met} pct={p.disputes_met ? 100 : 0} />
      <p className="t-small t-muted">Tier 4 is earned through great work — there's nothing to upload.</p>
    </div>
  );
}

function Metric({ label, value, met, pct }: { label: string; value: string; met: boolean; pct: number }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="t-small">{met ? '✓ ' : ''}{label}</span>
        <span className="t-small t-muted">{value}</span>
      </div>
      <div style={{ marginTop: 4 }}><ProgressBar current={pct} total={100} /></div>
    </div>
  );
}
