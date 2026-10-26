'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { addPantryItem, deletePantryItem } from '@/app/actions/pantry';
import { addRecipeToShopping } from '@/app/actions/planning';
import { LiveMessage } from '@/components/client-ui';
import { Badge, Button, EmptyState, Input, Select, buttonClass } from '@/components/ui';
import { PANTRY_LOCATIONS, daysUntil, expiryStatus, type PantryItem, type PantryLocation, type RecipeSuggestion } from '@/lib/pantry/match';

export function PantryView({ items, suggestions, today }: { items: PantryItem[]; suggestions: RecipeSuggestion[]; today: string }) {
  const t = useTranslations('pantry');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [expires, setExpires] = useState('');
  const [location, setLocation] = useState<PantryLocation>('fridge');
  const [note, setNote] = useState('');

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quantity.trim() === '' ? null : Number(quantity.replace(',', '.'));
    if (!name.trim() || (q !== null && !Number.isFinite(q))) return;
    start(async () => {
      const res = await addPantryItem({ name, quantity: q, unit: unit || null, expires_on: expires || null, location, note: note || null });
      if (res.ok) {
        setName('');
        setQuantity('');
        setUnit('');
        setExpires('');
        setNote('');
        setMsg({ text: t('added'), tone: 'success' });
        router.refresh();
      } else setMsg({ text: te(res.error), tone: 'error' });
    });
  };

  const badge = (i: PantryItem) => {
    const s = expiryStatus(i.expires_on, today);
    const d = daysUntil(i.expires_on, today);
    if (s === 'expired') return <Badge tone="tomato">{t('expired')}</Badge>;
    if (s === 'soon') return <Badge tone="saffron">{d === 0 ? t('today') : t('inDays', { n: d ?? 0 })}</Badge>;
    return null;
  };

  const addMissing = (s: RecipeSuggestion) =>
    start(async () => {
      const res = await addRecipeToShopping(s.recipeId, null, s.missingIndexes);
      setMsg(res.ok ? { text: t('missingAdded', { n: res.data.added + res.data.merged }), tone: 'success' } : { text: te(res.error), tone: 'error' });
    });

  return (
    <div className="flex flex-col gap-6">
      <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />

      <section aria-labelledby="tonight" className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <h2 id="tonight" className="text-xl font-bold">
          {t('tonightTitle')}
        </h2>
        <p className="text-sm text-muted">{t('tonightLead')}</p>
        {suggestions.length === 0 ? (
          <p className="py-3 text-muted">{t('tonightEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {suggestions.map((s) => (
              <li key={s.recipeId} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/recipes/${s.recipeId}`} className="font-semibold underline-offset-2 hover:underline">
                    {s.title}
                  </Link>
                  <Badge tone="basil">{t('coverage', { have: s.have, total: s.total })}</Badge>
                  {s.expiringUsed.length > 0 && <Badge tone="saffron">{t('usesExpiring', { names: s.expiringUsed.join(', ') })}</Badge>}
                </div>
                {s.missingNames.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">{t('missing', { names: s.missingNames.join(', ') })}</span>
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => addMissing(s)}>
                      {t('addMissing')}
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm text-muted">{t('nothingMissing')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={add} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <h2 className="text-xl font-bold">{t('addTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t('name')}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t('location')}</span>
            <Select value={location} onChange={(e) => setLocation(e.target.value as PantryLocation)}>
              {PANTRY_LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {t(`loc_${l}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t('quantity')}</span>
            <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t('unit')}</span>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t('expires')}</span>
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t('note')}</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </label>
        </div>
        <div>
          <button type="submit" className={buttonClass('primary')} disabled={pending || !name.trim()}>
            {tc('add')}
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <EmptyState title={t('emptyTitle')}>{t('empty')}</EmptyState>
      ) : (
        <section aria-labelledby="stock" className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2">
          <h2 id="stock" className="py-2 text-xl font-bold">
            {t('stockTitle', { n: items.length })}
          </h2>
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2">
                <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
                  <span className="flex flex-wrap items-center gap-2">
                    {i.quantity !== null && <span className="tabular font-semibold">{i.quantity} {i.unit} </span>}
                    {i.name}
                    {badge(i)}
                  </span>
                  <span className="text-xs text-muted">
                    {t(`loc_${i.location}`)}
                    {i.expires_on && ` · ${t('expiresOn', { date: i.expires_on })}`}
                    {i.note && ` · ${i.note}`}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-11 shrink-0 px-0"
                  aria-label={t('remove', { name: i.name })}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await deletePantryItem(i.id);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
