import { useRef } from 'react';

// 6-box OTP entry. Auto-advances, supports paste, and surfaces the value via
// onChange. inputMode=numeric keeps the mobile numeric keypad up.
export function OtpInput({ value, onChange, length = 6 }: { value: string; onChange: (v: string) => void; length?: number }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (i: number, d: string) => {
    const digit = d.replace(/\D/g, '').slice(-1);
    const next = value.split('');
    next[i] = digit;
    const joined = next.join('').slice(0, length);
    onChange(joined);
    if (digit && i < length - 1) refs.current[i + 1]?.focus();
  };

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={value[i] ?? ''}
          inputMode="numeric"
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
            if (pasted) { onChange(pasted); refs.current[Math.min(pasted.length, length - 1)]?.focus(); }
          }}
          style={{
            width: 48, height: 56, textAlign: 'center', fontSize: 22, fontWeight: 700,
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text-primary)',
          }}
        />
      ))}
    </div>
  );
}
