import { apiRequest } from './client';

/**
 * Packages, quota and payments (Pay per Event).
 *
 * A package grants three things at once: a pool of tickets, a number of events the
 * vendor may create, and a ceiling on how many tickets any single event may hold. The
 * pool and the ceiling are separate limits, so having tickets left over does not mean
 * they can all go into the next event.
 */

export type Package = {
  id: string;
  code: 'free' | 'copper' | 'silver' | 'gold' | string;
  name: string;
  tier: number;
  price_baht: number;
  event_quota: number;
  ticket_per_event: number;
  ticket_total: number;
  event_topup_price: number;
  ticket_topup_price: number;
  ticket_topup_bundle_size: number;
  topup_enabled: boolean;
};

export type Quota = {
  ticket_balance: number;
  event_balance: number;
  ticket_per_event: number;
  package: {
    code: string;
    name: string;
    tier: number;
    topup_enabled: boolean;
    event_topup_price: number;
    ticket_topup_price: number;
    ticket_topup_bundle_size: number;
  };
};

export type PurchaseType = 'package' | 'event_topup' | 'ticket_topup';

export type Purchase = {
  id: string;
  type: PurchaseType;
  package_code: string;
  unit_price_baht: number;
  quantity: number;
  amount_baht: number;
  tickets_added: number;
  events_added: number;
  target_event_id: string | null;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  created_at: string;
  paid_at: string | null;
};

export type PaymentIntent = {
  id: string;
  provider: string;
  status: string;
  provider_ref: string;
  amount_baht: number;
  payload: {
    kind?: string;
    qr_data?: string;
    amount_baht?: string;
    /** Present only while a mock gateway is configured; drives the dev-only pay button. */
    dev_confirm?: { provider: string; provider_ref: string; status: string };
  } | null;
  expires_at: string | null;
};

export const listPackages = () => apiRequest<Package[]>('/v1/packages');

export const getQuota = () => apiRequest<Quota>('/v1/vendors/me/quota');

export const listPurchases = () => apiRequest<Purchase[]>('/v1/vendors/me/purchases');

export const createPurchase = (body: {
  type: PurchaseType;
  package_id?: string;
  quantity?: number;
  target_event_id?: string;
}) => apiRequest<{ purchase: Purchase; payment: PaymentIntent }>('/v1/vendors/me/purchases', { method: 'POST', body });

export const getPurchase = (id: string) =>
  apiRequest<{ purchase: Purchase; payment_status: string | null }>(`/v1/vendors/me/purchases/${id}`);

/**
 * Stands in for the bank calling us back. Real gateways post here themselves — this
 * exists so the demo can complete a payment without one, and it goes through the exact
 * same endpoint rather than a shortcut that would need deleting later.
 */
export const confirmMockPayment = (body: { provider_ref: string; status: string }) =>
  apiRequest('/v1/payments/webhook', { method: 'POST', body, auth: false });
