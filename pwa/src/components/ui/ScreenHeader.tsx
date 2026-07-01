import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../theme/useTheme';

// Lightweight top bar: optional back button, title, and a theme toggle.
export function ScreenHeader({ title, onBack, showBack = true }: { title?: string; onBack?: () => void; showBack?: boolean }) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 'var(--space-md)',
        paddingTop: 'calc(var(--space-md) + env(safe-area-inset-top))',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        position: 'sticky', top: 0, zIndex: 10,
      }}
    >
      {showBack && (
        <button
          aria-label="Back"
          onClick={() => (onBack ? onBack() : navigate(-1))}
          style={{ width: 44, height: 44, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 20 }}
        >
          ←
        </button>
      )}
      <h1 className="t-h3" style={{ flex: 1 }}>{title}</h1>
      <button
        aria-label="Toggle dark mode"
        onClick={toggle}
        style={{ width: 44, height: 44, border: 'none', background: 'transparent', fontSize: 18 }}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </header>
  );
}
