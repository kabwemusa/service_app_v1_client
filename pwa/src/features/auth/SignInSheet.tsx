import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/ui';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { OtpInput } from '../../components/ui/OtpInput';
import { useAuthStore } from '../../store/authStore';

// Minimal, single-purpose sign-in: phone + OTP, framed as part of the action
// ("almost there"). Nothing else asked. Used both by the customer first-action
// flow and the provider Account step.
export function SignInSheet({
  open, onClose, onSuccess, intent = 'CUSTOMER', actionLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  intent?: 'CUSTOMER' | 'PROVIDER';
  actionLabel?: string;
}) {
  const { t } = useTranslation();
  const { requestOtp, verifyOtp, loading, error, clearError } = useAuthStore();
  const [phase, setPhase] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [normalized, setNormalized] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!open) { setPhase('phone'); setPhone(''); setOtp(''); setCooldown(0); clearError(); }
  }, [open, clearError]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const send = async () => {
    const res = await requestOtp(phone, intent);
    if (res) { setNormalized(res.phone); setPhase('otp'); setCooldown(res.resend_after); }
  };

  const verify = async () => {
    const guestToken = localStorage.getItem('guest_token');
    const ok = await verifyOtp(normalized || phone, otp, guestToken);
    if (ok) onSuccess();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={actionLabel ?? t('auth.signInToContinue')}>
      {phase === 'phone' ? (
        <>
          <p className="t-small t-muted" style={{ marginBottom: 'var(--space-md)' }}>{t('auth.phoneSub')}</p>
          <PhoneInput value={phone} onChange={setPhone} placeholder={t('auth.phonePlaceholder')} />
          {error && <p className="t-small" style={{ color: 'var(--danger)', marginTop: 8 }}>{error.message}</p>}
          <div style={{ marginTop: 'var(--space-lg)' }}>
            <Button onClick={send} loading={loading} disabled={phone.replace(/\D/g, '').length < 9}>
              {t('auth.sendCode')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="t-small t-muted" style={{ marginBottom: 'var(--space-md)' }}>
            {t('auth.otpSub', { phone: normalized })}
          </p>
          <OtpInput value={otp} onChange={setOtp} />
          {error && <p className="t-small" style={{ color: 'var(--danger)', marginTop: 8 }}>{error.message}</p>}
          <div style={{ marginTop: 'var(--space-lg)' }}>
            <Button onClick={verify} loading={loading} disabled={otp.length < 6}>{t('auth.verify')}</Button>
          </div>
          <div style={{ marginTop: 'var(--space-sm)' }}>
            <Button variant="ghost" onClick={send} disabled={cooldown > 0}>
              {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
            </Button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
