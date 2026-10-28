import { createHash } from 'node:crypto';
import { normalizeText } from '@/lib/recipes/duplicates';

/** Tetto di elementi per chiamata a add_shopping_items (DB-04). */
export const MAX_SHOPPING_ITEMS = 200;

interface BatchItem {
  name: string;
  quantity: number | null;
  unit: string | null;
}

/**
 * Unisce gli elementi equivalenti (stessa chiave del DB: nome normalizzato + unita +
 * presenza di quantita) sommando le quantita; resta la prima occorrenza (ricetta inclusa).
 * Va applicato PRIMA del tetto per chiamata, cosi' i duplicati non lo fanno scattare.
 */
export function collapseShoppingItems<T extends BatchItem>(items: T[]): T[] {
  const out: T[] = [];
  const index = new Map<string, T>();
  for (const item of items) {
    const key = `${normalizeText(item.name)}\u0000${item.unit ?? ''}\u0000${item.quantity === null ? 'n' : 'q'}`;
    const prev = index.get(key);
    if (prev) {
      if (prev.quantity !== null && item.quantity !== null) prev.quantity = Math.round((prev.quantity + item.quantity) * 1000) / 1000;
      continue;
    }
    const copy = { ...item };
    index.set(key, copy);
    out.push(copy);
  }
  return out;
}

/** Suddivide in blocchi da al massimo `size` elementi, preservando l'ordine. */
export function chunkShoppingItems<T>(items: T[], size: number = MAX_SHOPPING_ITEMS): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Chiave di idempotenza del blocco `index`: il blocco 0 usa la chiave base (retro-compatibile),
 * gli altri una chiave UUID deterministica derivata, cosi' un retry rigioca gli stessi blocchi.
 */
export function chunkIdempotencyKey(baseKey: string, index: number): string {
  if (index === 0) return baseKey;
  const h = createHash('sha256').update(`${baseKey}:${index}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
