import { create } from 'zustand';

// The first committing action (Book/Save/Message/track) a guest takes is held
// here so it survives the sign-in bottom sheet. After OTP verify we replay it —
// the booking the user tapped is exactly where they return to.
export interface PendingAction {
  kind: 'book' | 'save' | 'message';
  serviceId: string;
  label: string; // for the "almost there" sheet copy
}

interface PendingState {
  pending: PendingAction | null;
  signInOpen: boolean;
  requireAuth: (action: PendingAction) => void; // opens the sheet for a guest action
  resolve: () => PendingAction | null;          // consume after auth
  closeSheet: () => void;
}

export const usePendingAction = create<PendingState>((set, get) => ({
  pending: null,
  signInOpen: false,
  requireAuth: (action) => set({ pending: action, signInOpen: true }),
  resolve: () => {
    const p = get().pending;
    set({ pending: null, signInOpen: false });
    return p;
  },
  closeSheet: () => set({ signInOpen: false }),
}));
