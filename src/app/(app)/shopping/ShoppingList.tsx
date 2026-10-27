'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Printer, Trash2 } from 'lucide-react';
import { addShoppingItem, clearCheckedItems, deleteShoppingItem, toggleShoppingItem } from '@/app/actions/planning';
import { setItemAisle } from '@/app/actions/shopping';
import { AISLES, aisleFor, groupByAisle, normalizeName, type Aisle } from '@/lib/shopping/aisles';
import { parseIngredientLine, formatQuantity } from '@/lib/recipes/ingredient-parser';
import { UNIT_KEYS } from '@/lib/recipes/units';
import { LiveMessage } from '@/components/client-ui';
import { Button, EmptyState, Input, Select, buttonClass, cx } from '@/components/ui';

export interface Item {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  checked: boolean;
  recipe_id: string | null;
  recipe_title: string | null;
  added_by: string | null;
  checked_by: string | null;
}

export function ShoppingList({ items, listId, overrides, showPeople }: { items: Item[]; listId: string; overrides: Record<string, Aisle>; showPeople: boolean }) {
  const t = useTranslations('shopping');
  const tu = useTranslations('units');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pending, start] = useTransition();
  const [localOverrides, setLocalOverride] = useOptimistic(overrides, (state: Record<string, Aisle>, patch: { key: string; aisle: Aisle }) => ({ ...state, [patch.key]: patch.aisle }));
  const [optimistic, setOptimistic] = useOptimistic(items, (state: Item[], patch: { id: string; checked?: boolean; removed?: boolean }) =>
    patch.removed ? state.filter((i) => i.id !== patch.id) : state.map((i) => (i.id === patch.id ? { ...i, checked: patch.checked ?? i.checked } : i)),
  );

  const unit = (u: string | null) => (!u ? '' : UNIT_KEYS.includes(u) ? tu(u) : u);
  const toBuy = optimistic.filter((i) => !i.checked);
  const bought = optimistic.filter((i) => i.checked);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseIngredientLine(text);
    if (!parsed.name) return;
    start(async () => {
      try {
        const res = await addShoppingItem({ list_id: listId, idempotency_key: crypto.randomUUID(), name: parsed.name, quantity: parsed.quantity, unit: parsed.unit, note: parsed.note ?? null });
        if (res.ok) {
          setText('');
          setMsg({ text: res.data.merged ? t('merged') : t('added'), tone: 'success' });
          router.refresh();
        } else setMsg({ text: te(res.error), tone: 'error' });
      } catch {
        setMsg({ text: t('offline'), tone: 'error' });
      }
    });
  };

  // L'aggiornamento ottimistico rientra da solo a fine transizione: se l'azione fallisce basta non rinfrescare e avvisare.
  // Senza rete la server action lancia: si annulla l'ottimistico (a fine transizione) e si avvisa, senza pagina d'errore.
  const run = async (fn: () => Promise<{ ok: boolean; error?: Parameters<typeof te>[0] }>) => {
    try {
      const res = await fn();
      if (res.ok) router.refresh();
      else setMsg({ text: te(res.error ?? 'generic'), tone: 'error' });
    } catch {
      setMsg({ text: t('offline'), tone: 'error' });
    }
  };

  const row = (i: Item) => (
    <li key={i.id} className="flex items-center gap-3 py-2">
      <input
        id={`it-${i.id}`}
        type="checkbox"
        checked={i.checked}
        className="size-6 shrink-0 accent-[var(--basil)]"
        onChange={(e) => {
          const checked = e.target.checked;
          start(async () => {
            setOptimistic({ id: i.id, checked });
            await run(() => toggleShoppingItem(i.id, checked));
          });
        }}
      />
      <label htmlFor={`it-${i.id}`} className={cx('flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center', i.checked && 'text-muted line-through')}>
        <span>
          {i.quantity !== null && <span className="tabular font-semibold">{formatQuantity(i.quantity, locale)} {unit(i.unit)} </span>}
          {i.quantity === null && i.unit && <span className="font-semibold">{unit(i.unit)} </span>}
          {i.name}
          {i.note && <span className="text-muted">, {i.note === 'q.b.' ? t('toTaste') : i.note}</span>}
        </span>
        {i.recipe_title && <span className="text-xs text-muted no-underline">{t('fromRecipe', { title: i.recipe_title })}</span>}
        {showPeople && (i.checked ? i.checked_by ?? '' : i.added_by ?? '') && (
          <span className="text-xs text-muted no-underline">
            {i.checked ? t('checkedBy', { name: i.checked_by ?? t('you') }) : t('addedBy', { name: i.added_by ?? t('you') })}
          </span>
        )}
      </label>
      <Select
        aria-label={t('aisleLabel', { name: i.name })}
        className="no-print w-auto max-w-32 shrink-0 text-sm"
        value={aisleFor(i.name, localOverrides)}
        onChange={(e) => {
          const aisle = e.target.value as Aisle;
          start(async () => {
            setLocalOverride({ key: normalizeName(i.name), aisle });
            await run(async () => {
              await setItemAisle(listId, i.name, aisle);
              return { ok: true };
            });
          });
        }}
      >
        {AISLES.map((a) => (
          <option key={a} value={a}>
            {t(`aisles.${a}`)}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="ghost"
        className="no-print size-11 shrink-0 px-0"
        aria-label={t('removeItem', { name: i.name })}
        onClick={() =>
          start(async () => {
            setOptimistic({ id: i.id, removed: true });
            await run(() => deleteShoppingItem(i.id));
          })
        }
      >
        <Trash2 aria-hidden className="size-4" />
      </Button>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={add} className="no-print flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <label htmlFor="newitem" className="font-semibold">
          {t('addLabel')}
        </label>
        <div className="flex gap-2">
          <Input id="newitem" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('addPlaceholder')} maxLength={200} />
          <button type="submit" className={buttonClass('primary')} disabled={pending || !text.trim()}>
            {tc('add')}
          </button>
        </div>
        <p className="text-sm text-muted">{t('mergeNote')}</p>
        <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
      </form>

      {optimistic.length === 0 ? (
        <EmptyState title={t('emptyTitle')} action={<Link href="/plan" className={buttonClass('secondary')}>{t('openPlan')}</Link>}>
          {t('empty')}
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby="tobuy" className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2">
            <h2 id="tobuy" className="py-2 text-xl font-bold">
              {t('toBuy', { n: toBuy.length })}
            </h2>
            {groupByAisle(toBuy, localOverrides).map((g) => (
              <div key={g.aisle} className="py-1">
                <h3 className="pt-2 text-sm font-bold uppercase tracking-wide text-muted">{t(`aisles.${g.aisle}`)}</h3>
                <ul className="divide-y divide-line">{g.items.map(row)}</ul>
              </div>
            ))}
          </section>
          {bought.length > 0 && (
            <section aria-labelledby="bought" className="no-print rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2">
              <div className="flex items-center justify-between gap-2 py-2">
                <h2 id="bought" className="text-xl font-bold">
                  {t('bought', { n: bought.length })}
                </h2>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => run(() => clearCheckedItems(listId)))}>
                  {t('clearBought')}
                </Button>
              </div>
              <ul className="divide-y divide-line">{bought.map(row)}</ul>
            </section>
          )}
          <div className="no-print flex flex-wrap gap-2">
            <Link href={`/print/shopping?list=${listId}`} target="_blank" className={buttonClass('secondary')}>
              <Printer aria-hidden className="size-5" />
              {t('print')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
