import { useRef, useState } from 'react';

// Photo capture for KYC (NRC/selfie) and the public avatar. Uses a native file
// input with `capture` so mobile opens the camera directly. Shows a preview and
// a retake affordance (NRC re-take / selfie retry per the onboarding edge cases).
export function PhotoCapture({
  label, onSelect, capture = 'environment', shape = 'rect',
}: {
  label: string;
  onSelect: (file: File) => void;
  capture?: 'environment' | 'user';
  shape?: 'rect' | 'circle';
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const pick = (file?: File) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    onSelect(file);
  };

  return (
    <div style={{ marginBottom: 'var(--space-md)' }}>
      <span className="t-label" style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        style={{
          width: '100%', minHeight: preview ? undefined : 120,
          border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)',
          background: 'var(--surface)', color: 'var(--text-secondary)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: 'var(--space-md)',
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt={label}
            style={{
              width: shape === 'circle' ? 96 : '100%',
              height: shape === 'circle' ? 96 : 160,
              objectFit: 'cover',
              borderRadius: shape === 'circle' ? '50%' : 'var(--radius-sm)',
            }}
          />
        ) : (
          <span aria-hidden style={{ fontSize: 28 }}>📷</span>
        )}
        <span className="t-small">{preview ? 'Retake' : 'Tap to take a photo'}</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture={capture}
        hidden
        onChange={(e) => pick(e.target.files?.[0] ?? undefined)}
      />
    </div>
  );
}
