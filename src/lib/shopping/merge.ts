import { normalizeText } from '@/lib/recipes/duplicates';

export interface ShoppingItemLike {
  id?: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  checked?: boolean;
}

export interface MergePlan<T extends ShoppingItemLike> {
  /** existing items whose quantity must be increased */
  updates: { id: string; quantity: number | null; /** amount to ADD to the stored quantity (applied atomically by the DB) */ delta: number }[];
  /** new rows to insert */
  inserts: T[];
}

function sameName(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

/**
 * Plans how to add items to a shopping list without making unsafe guesses:
 * two lines are merged ONLY if the normalised name is identical AND the unit
 * is identical (both may be absent) AND the existing line is not yet checked.
 * Different units ("200 g" vs "1 cup") or similar-but-different names
 * ("farina 00" vs "farina integrale", "uovo" vs "uova") stay on separate lines.
 */
export function planShoppingMerge<T extends ShoppingItemLike>(existing: ShoppingItemLike[], incoming: T[]): MergePlan<T> {
  const updates = new Map<string, number | null>();
  const inserts: T[] = [];

  for (const item of incoming) {
    const target = existing.find(
      (e) => e.id && !e.checked && sameName(e.name, item.name) && (e.unit ?? null) === (item.unit ?? null),
    );
    const pendingInsert = inserts.find(
      (e) => sameName(e.name, item.name) && (e.unit ?? null) === (item.unit ?? null),
    );

    if (target && target.id) {
      const current = updates.has(target.id) ? updates.get(target.id)! : target.quantity;
      if (current === null && item.quantity === null) {
        updates.set(target.id, null); // "sale" + "sale": one line, no quantity
      } else if (current !== null && item.quantity !== null) {
        updates.set(target.id, Math.round((current + item.quantity) * 1000) / 1000);
      } else {
        inserts.push(item); // one has a quantity, the other not: keep separate
      }
    } else if (pendingInsert) {
      if (pendingInsert.quantity !== null && item.quantity !== null) {
        pendingInsert.quantity = Math.round((pendingInsert.quantity + item.quantity) * 1000) / 1000;
      } else if (!(pendingInsert.quantity === null && item.quantity === null)) {
        inserts.push(item);
      }
    } else {
      inserts.push({ ...item });
    }
  }

  return {
    updates: [...updates.entries()]
      .filter(([id, q]) => {
        const orig = existing.find((e) => e.id === id);
        return orig && orig.quantity !== q;
      })
      .map(([id, quantity]) => {
        const orig = existing.find((e) => e.id === id)?.quantity ?? null;
        return { id, quantity, delta: quantity !== null && orig !== null ? Math.round((quantity - orig) * 1000) / 1000 : 0 };
      }),
    inserts,
  };
}
