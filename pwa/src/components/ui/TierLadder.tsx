import { Card, Pill } from './ui';

export interface LadderRung {
  type: string;
  label: string;
  done: boolean;
  blocking: boolean;
}

export interface TierLadderData {
  risk_tier: number;
  risk_label: string | null;
  rungs: LadderRung[];
  missing: string[];
}

// The capability ladder shown on go-live and Profile → Verification: every rung
// (current / unlocks / required), what's done, and the immediate blocker. Trust
// scores are never part of this — only verified facts (TrustEngine contract).
export function TierLadder({ data, title }: { data: TierLadderData; title?: string }) {
  return (
    <Card>
      {title && <h3 className="t-h3" style={{ marginBottom: 'var(--space-sm)' }}>{title}</h3>}
      {data.risk_label && (
        <p className="t-small t-muted" style={{ marginBottom: 'var(--space-md)' }}>
          {data.risk_label} category
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {data.rungs.map((r, i) => (
          <li
            key={r.type}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 'var(--space-sm) 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: r.done ? 'var(--success-light)' : 'var(--primary-light)',
                color: r.done ? 'var(--success)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: 700,
              }}
            >
              {r.done ? '✓' : i + 1}
            </span>
            <span className="t-body" style={{ flex: 1, color: r.done ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
              {r.label}
            </span>
            {r.done
              ? <Pill tone="success">Done</Pill>
              : r.blocking
                ? <Pill tone="warning">Next</Pill>
                : <Pill>Unlocks more</Pill>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
