import type { ReactNode } from 'react';
import { useEffect } from 'react';

// Bottom sheet for the sign-in flow and pickers. Slides up, dims the backdrop,
// traps Escape, and restores scroll. Reused, never re-styled.
export function BottomSheet({
  open, onClose, title, children, dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissible) onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => dismissible && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'fade-in .15s',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: 'var(--surface)',
          borderTopLeftRadius: 'var(--radius-lg)', borderTopRightRadius: 'var(--radius-lg)',
          padding: 'var(--space-lg)',
          paddingBottom: 'calc(var(--space-lg) + env(safe-area-inset-bottom))',
          animation: 'sheet-up .25s ease-out',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--border)', margin: '0 auto var(--space-md)' }} />
        {title && <h2 className="t-h3" style={{ marginBottom: 'var(--space-md)' }}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
