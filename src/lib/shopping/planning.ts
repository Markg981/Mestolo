import { fromBaseAmount, toBaseAmount } from '@/lib/recipes/convert';
import { expiryStatus, pantryMatchKey, type PantryItem } from '@/lib/pantry/match';

export interface NeededItem {
  name: string;
  quantity: number | null;
  unit: string | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Sottrae dalla spesa quanto e' gia' in dispensa. Conservativa: scala solo se
 * nome (normalizzato) e dimensione dell'unita' coincidono (g/kg, ml/l...; mai
 * volume <-> massa) e le quantita' sono note da entrambe le parti. Le scorte
 * scadute non contano; la scorta e' condivisa fra le righe, quindi due ricette
 * con lo stesso ingrediente non la usano due volte. Totale -> riga rimossa,
 * parziale -> quantita' ridotta, altro -> riga invariata. Non muta l'input.
 */
export function subtractPantry<T extends NeededItem>(items: T[], pantry: PantryItem[], today: string): T[] {
  const stock = new Map<string, number>(); // chiave|dimensione -> quantita' base disponibile
  for (const p of pantry) {
    if (p.quantity === null || !(p.quantity > 0) || expiryStatus(p.expires_on, today) === 'expired') continue;
    const key = pantryMatchKey(p.name);
    if (!key) continue;
    const { dim, amount } = toBaseAmount(p.quantity, p.unit);
    stock.set(`${key}|${dim}`, (stock.get(`${key}|${dim}`) ?? 0) + amount);
  }

  const out: T[] = [];
  for (const item of items) {
    if (item.quantity === null || !(item.quantity > 0)) {
      out.push(item);
      continue;
    }
    const key = pantryMatchKey(item.name);
    const { dim, amount } = toBaseAmount(item.quantity, item.unit);
    const sk = `${key}|${dim}`;
    const have = key ? (stock.get(sk) ?? 0) : 0;
    if (have <= 0) {
      out.push(item);
    } else if (have >= amount - 1e-9) {
      stock.set(sk, have - amount); // coperto del tutto: la riga sparisce
    } else {
      stock.set(sk, 0);
      out.push({ ...item, quantity: round3(fromBaseAmount(amount - have, item.unit)) });
    }
  }
  return out;
}
