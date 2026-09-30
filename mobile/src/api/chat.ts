import { apiRequest } from './client';

type OpenedConversation = { id: string; shop_id: string; shop_name: string };

/**
 * Get-or-create the caller's room with a shop. The backend upserts on the
 * [shopId, userId] unique constraint, so calling this repeatedly is safe.
 */
export async function openShopConversation(shopId: string): Promise<OpenedConversation> {
  return apiRequest<OpenedConversation>(`/v1/shops/${shopId}/conversations`, { method: 'POST' });
}
