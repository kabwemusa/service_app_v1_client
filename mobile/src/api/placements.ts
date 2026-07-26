import { api } from './client';

/**
 * The server-computed checkout price breakdown for a booking. The provider's
 * payout is never affected — `discount_zmw` reduces the customer's total only.
 */
export interface CheckoutPreview {
  original_zmw:    number;
  service_fee_zmw: number;
  discount_zmw:    number;
  total_zmw:       number;
  campaign: { id: string; name: string; offer_type: string } | null;
  code_invalid:    boolean;
}

export const placementsApi = {
  /**
   * GET /bookings/{id}/checkout-preview — original → discount → total for the
   * current customer, optionally with a promo code. Non-mutating: the discount
   * is re-checked and applied for real at pay time.
   */
  checkoutPreview: (bookingId: string, code?: string) => {
    const q = code ? `?code=${encodeURIComponent(code)}` : '';
    return api.get<CheckoutPreview>(`/bookings/${bookingId}/checkout-preview${q}`);
  },
};
