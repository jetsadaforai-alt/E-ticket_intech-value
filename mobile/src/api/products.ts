import { apiRequest } from './client';

/**
 * Shop products, and which products an event's discount applies to.
 *
 * An event with an empty product list discounts the whole shop — that is the default and
 * what every event meant before products existed. Attaching products narrows the discount
 * to just those items.
 *
 * Products are archived, never deleted: an event that already discounts an item keeps
 * showing it, so a ticket someone is holding never loses the explanation of what it was
 * for. Archived items simply stop appearing in the picker for new events.
 */

export type Product = {
  id: string;
  shopId: string;
  name: string;
  priceBaht: string; // Prisma Decimal arrives as a string
  imageUrl: string | null;
  status: 'active' | 'archived';
  sortOrder: number;
  createdAt: string;
};

export const listProducts = (shopId: string, includeArchived = false) =>
  apiRequest<Product[]>(`/v1/shops/${shopId}/products${includeArchived ? '?include_archived=1' : ''}`);

export const createProduct = (shopId: string, body: { name: string; price_baht: number }) =>
  apiRequest<Product>(`/v1/shops/${shopId}/products`, { method: 'POST', body });

export const updateProduct = (
  id: string,
  body: { name?: string; price_baht?: number; status?: 'active' | 'archived' }
) => apiRequest<Product>(`/v1/products/${id}`, { method: 'PATCH', body });

/** Archives rather than deletes — see the note above. */
export const archiveProduct = (id: string) => apiRequest<Product>(`/v1/products/${id}`, { method: 'DELETE' });

export const uploadProductImage = (id: string, formData: FormData) =>
  apiRequest<Product>(`/v1/products/${id}/image`, { method: 'POST', formData });

/** Replaces the event's whole product set. An empty array returns it to shop-wide. */
export const setEventProducts = (eventId: string, productIds: string[]) =>
  apiRequest<Product[]>(`/v1/events/${eventId}/products`, {
    method: 'PUT',
    body: { product_ids: productIds },
  });

/** Price after the event's discount, floored at 0 so a big discount never shows negative. */
export function discountedPrice(priceBaht: string | number, discountBaht: string | number): number {
  const price = Number(priceBaht);
  const discount = Number(discountBaht);
  if (!Number.isFinite(price) || !Number.isFinite(discount)) return 0;
  return Math.max(0, price - discount);
}

/**
 * One-line badge summarizing an event's discount, whether it's one flat rate (whole-shop,
 * or a product-scoped event whose linked products all discount the same) or a spread of
 * per-product rates. min === max covers both "no products linked" and "linked but equal"
 * without the caller needing to know which — the backend already guarantees min === max
 * whenever there's no real difference to report, so this never has to branch on that itself.
 */
export function formatDiscountBadge(min: number, max: number): string {
  return min === max ? `ลด ${max} บาท` : `ลดสูงสุด ${max} บาท`;
}
