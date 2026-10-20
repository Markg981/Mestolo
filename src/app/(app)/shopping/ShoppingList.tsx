'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Printer, Trash2 } from 'lucide-react';
import { addShoppingItem, clearCheckedItems, deleteShoppingItem, toggleShoppingItem } from '@/app/actions/planning';
import { parseIngredientLine, formatQuantity } from '@/lib/recipes/ingredient-parser';
import { UNIT_KEYS } from '@/lib/recipes/units';
import { LiveMessage } from '@/components/client-ui';
import { Button, EmptyState, Input, buttonClass, cx } from '@/components/ui';

export interface Item {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  checked: boolean;
  recipe_id: string | null;
  recipe_title: string | null;
}

export function ShoppingList({ items }: { items: Item[] }) {
  const t = useTranslations('shopping');
  const tu = useTranslations('units');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pending, start] = useTransition();
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
      const res = await addShoppingItem({ name: parsed.name, quantity: parsed.quantity, unit: parsed.unit, note: parsed.note ?? null });
      if (res.ok) {
        setText('');
        setMsg({ text: res.data.merged ? t('merged') : t('added'), tone: 'success' });
        router.refresh();
      } else setMsg({ text: te(res.error), tone: 'error' });
    });
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
            await toggleShoppingItem(i.id, checked);
            router.refresh();
          });
        }}
      />
      <label htmlFor={`it-${i.id}`} className={cx('flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center', i.checked && 'text-muted line-through')}>
        <span>
          {i.quantity !== null && <span className="tabular font-semibold">{formatQuantity(i.quantity, locale)} {unit(i.unit)} </span>}
          {i.quantity === null && i.unit && <span className="font-semibold">{unit(i.unit)} </span>}
          {i.name}
          {i.note && <span className="text-muted">, {i.note}</span>}
        </span>
        {i.recipe_title && <span className="text-xs text-muted no-underline">{t('fromRecipe', { title: i.recipe_title })}</span>}
      </label>
      <Button
        size="sm"
        variant="ghost"
        className="no-print size-10 shrink-0 px-0"
        aria-label={t('removeItem', { name: i.name })}
        onClick={() =>
          start(async () => {
            setOptimistic({ id: i.id, removed: true });
            await deleteShoppingItem(i.id);
            router.refresh();
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
            <ul className="divide-y divide-line">{toBuy.map(row)}</ul>
          </section>
          {bought.length > 0 && (
            <section aria-labelledby="bought" className="no-print rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2">
              <div className="flex items-center justify-between gap-2 py-2">
                <h2 id="bought" className="text-xl font-bold">
                  {t('bought', { n: bought.length })}
                </h2>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await clearCheckedItems(); router.refresh(); })}>
                  {t('clearBought')}
                </Button>
              </div>
              <ul className="divide-y divide-line">{bought.map(row)}</ul>
            </section>
          )}
          <div className="no-print flex flex-wrap gap-2">
            <Link href="/print/shopping" target="_blank" className={buttonClass('secondary')}>
              <Printer aria-hidden className="size-5" />
              {t('print')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
