import { apiRequest } from './client';

export type SharedTicket = {
  ticket_id: string;
  event_title: string;
  shared_at: string;
  claimed_by_name: string | null;
  claimed_at: string | null;
  status: 'pending' | 'claimed' | 'expired';
};

export type ClaimedTicket = {
  ticket_id: string;
  event_title: string;
  shared_by_name: string;
  claimed_at: string;
};

export const listMyShares = () => apiRequest<SharedTicket[]>('/v1/tickets/me/shares');

export const listMyClaims = () => apiRequest<ClaimedTicket[]>('/v1/tickets/me/claims');
