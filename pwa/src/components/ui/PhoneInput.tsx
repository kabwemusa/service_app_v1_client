import { inputStyle } from './ui';

// Zambian phone entry with a fixed +260 affix. We send the raw value; the
// backend's PhoneNumber normalizer accepts 0xx / 9xx / +260 forms, so we don't
// over-validate here — just keep the keypad numeric.
export function PhoneInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          minHeight: 48, display: 'inline-flex', alignItems: 'center', padding: '0 var(--space-md)',
          borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
          background: 'var(--surface)', fontWeight: 600,
        }}
      >
        +260
      </span>
      <input
        value={value}
        inputMode="tel"
        autoComplete="tel"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, flex: 1 }}
      />
    </div>
  );
}
