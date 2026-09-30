import { useCallback, useEffect, useMemo, useState } from 'react';
import { listProducts, createProduct, type Product } from '../api/products';

/**
 * Which of a shop's products an event discounts.
 *
 * Selecting nothing is a valid, meaningful state — it means the discount covers the whole
 * shop — so this never treats an empty selection as an error or an unfinished form.
 *
 * The picker offers the shop's `active` products, plus any product this event already
 * discounts that has since been archived. Those are kept visible so the shop can see and
 * un-tick them; the backend lets an event keep an archived product it already had and
 * only refuses newly-added ones, so leaving them ticked saves fine.
 */
export function useEventProducts(shopId: string | undefined) {
  const [activeProducts, setActiveProducts] = useState<Product[]>([]);
  // Held separately rather than merged into activeProducts, because load() replaces that
  // list wholesale and the two can resolve in either order.
  const [attachedExtras, setAttachedExtras] = useState<Product[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Per-product flat-baht discount, keyed by product id — lives here rather than as
  // separate state in the form screen because its lifecycle is tied to selectedIds:
  // selecting a product gives it a discount field, deselecting removes it (see toggle
  // below), the same way attachedExtras is tied to hydrate().
  const [discounts, setDiscounts] = useState<Record<string, string>>({});
  // Vendor-set discount used when staff mark a redemption "product unavailable" during
  // scan — only meaningful once at least one product is linked, but kept as one flat
  // string here regardless so the form has somewhere to hold it while typing.
  const [fallbackDiscount, setFallbackDiscount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    try {
      setActiveProducts(await listProducts(shopId));
      setError(null);
    } catch {
      setError('โหลดรายการสินค้าไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  const available = useMemo(() => {
    const known = new Set(activeProducts.map((p) => p.id));
    return [...activeProducts, ...attachedExtras.filter((p) => !known.has(p.id))];
  }, [activeProducts, attachedExtras]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        // Deselecting drops its discount too — a stale entry for a product no longer
        // linked would otherwise ship in the submit body the next time it's re-selected.
        setDiscounts((prevDiscounts) => {
          const { [id]: _removed, ...rest } = prevDiscounts;
          return rest;
        });
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  }, []);

  const setProductDiscount = useCallback((id: string, value: string) => {
    setDiscounts((prev) => ({ ...prev, [id]: value }));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds([]);
    setDiscounts({});
    setFallbackDiscount('');
  }, []);

  /**
   * Seeds the selection from an event that already exists. Stable identity because the
   * manage screen calls it from inside its load callback. `discountsById`/`fallback` are
   * only ever passed for a product-scoped source event (clone/edit) — omitted, they leave
   * the discount state untouched, matching how a plain product picker (no discounts at
   * all) already uses this same hook.
   */
  const hydrate = useCallback(
    (products: Product[], discountsById?: Record<string, string>, fallback?: string) => {
      setSelectedIds(products.map((p) => p.id));
      setAttachedExtras(products);
      if (discountsById) setDiscounts(discountsById);
      if (fallback !== undefined) setFallbackDiscount(fallback);
    },
    []
  );

  /**
   * Creates a brand-new product without leaving the event form (Figma's step-1 "สร้าง
   * สินค้าใหม่" pattern) — reloads the list so the new product shows up, then selects it
   * for this event same as ticking an existing one would.
   */
  const createAndSelect = useCallback(
    async (input: { name: string; price_baht: number }) => {
      if (!shopId) return;
      setCreating(true);
      try {
        const product = await createProduct(shopId, input);
        await load();
        setSelectedIds((prev) => [...prev, product.id]);
        setError(null);
      } finally {
        setCreating(false);
      }
    },
    [shopId, load]
  );

  return {
    available,
    selectedIds,
    discounts,
    setProductDiscount,
    fallbackDiscount,
    setFallbackDiscount,
    loading,
    creating,
    error,
    setError,
    toggle,
    clear,
    hydrate,
    createAndSelect,
    reload: load,
    isEmpty: selectedIds.length === 0,
  };
}

export type EventProductsController = ReturnType<typeof useEventProducts>;
