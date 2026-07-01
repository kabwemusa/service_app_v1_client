import type { CSSProperties, ReactNode } from 'react';

// Small shared primitives in the project's flat design language: 8px radius,
// no shadows, dividers, 44px touch targets. All colors/spacing via CSS vars.

export function Button({
  children, onClick, variant = 'primary', disabled, loading, type = 'button', full = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  full?: boolean;
}) {
  const base: CSSProperties = {
    minHeight: 48,
    width: full ? '100%' : undefined,
    padding: '0 var(--space-lg)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid transparent',
    fontSize: 16,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    opacity: disabled || loading ? 0.55 : 1,
    transition: 'opacity .15s',
  };
  const variants: Record<string, CSSProperties> = {
    primary: { background: 'var(--primary)', color: '#fff' },
    secondary: { background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' },
    ghost: { background: 'transparent', color: 'var(--primary)' },
    danger: { background: 'var(--danger)', color: '#fff' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} style={{ ...base, ...variants[variant] }}>
      {loading ? <Spinner size={18} light={variant === 'primary' || variant === 'danger'} /> : children}
    </button>
  );
}

export function Card({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-md)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div style={{ height: 6, background: 'var(--border)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', transition: 'width .25s' }} />
    </div>
  );
}

export function Spinner({ size = 24, light = false }: { size?: number; light?: boolean }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        border: `2px solid ${light ? 'rgba(255,255,255,.4)' : 'var(--border)'}`,
        borderTopColor: light ? '#fff' : 'var(--primary)',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'spin .7s linear infinite',
      }}
    />
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: string; children: ReactNode; error?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: 'var(--space-md)' }}>
      <span className="t-label" style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
      {hint && !error && <span className="t-small t-muted" style={{ display: 'block', marginTop: 4 }}>{hint}</span>}
      {error && <span className="t-small" style={{ display: 'block', marginTop: 4, color: 'var(--danger)' }}>{error}</span>}
    </label>
  );
}

export const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 48,
  padding: '0 var(--space-md)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontSize: 16,
  fontFamily: 'inherit',
};

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const tones: Record<string, CSSProperties> = {
    neutral: { background: 'var(--primary-light)', color: 'var(--primary)' },
    success: { background: 'var(--success-light)', color: 'var(--success)' },
    warning: { background: 'var(--warning-light)', color: 'var(--warning)' },
  };
  return (
    <span style={{ ...tones[tone], padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 12, fontWeight: 600 }}>
      {children}
    </span>
  );
}
