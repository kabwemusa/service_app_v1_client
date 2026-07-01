import { useNavigate } from 'react-router-dom';
import { SignInSheet } from './SignInSheet';
import { usePendingAction } from '../../store/pendingActionStore';

// Renders the customer first-action sign-in sheet at the app root. On success it
// replays the pending action — the booking the guest tapped survives sign-in.
export function SignInHost() {
  const navigate = useNavigate();
  const { signInOpen, pending, closeSheet, resolve } = usePendingAction();

  return (
    <SignInSheet
      open={signInOpen}
      intent="CUSTOMER"
      actionLabel={pending?.label}
      onClose={closeSheet}
      onSuccess={() => {
        const action = resolve();
        if (action?.kind === 'book') navigate(`/book/${action.serviceId}`);
      }}
    />
  );
}
