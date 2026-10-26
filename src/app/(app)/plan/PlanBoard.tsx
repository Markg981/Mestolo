'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { GripVertical, MoveRight, Plus, ShoppingBasket, X } from 'lucide-react';
import { addPlanEntry, addWeekToShopping, deletePlanEntry, movePlanEntry } from '@/app/actions/planning';
import { LiveMessage, Modal } from '@/components/client-ui';
import { Button, Field, Input, Select, cx } from '@/components/ui';

export interface Entry {
  id: string;
  plan_date: string;
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  recipe_id: string | null;
  servings: number | null;
}

export function PlanBoard({ weekStart, days, slots, entries, recipes }: { weekStart: string; days: { iso: string; label: string; today: boolean }[]; slots: Entry['slot'][]; entries: Entry[]; recipes: { id: string; title: string }[] }) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<{ date: string; slot: Entry['slot'] } | null>(null);
  const [recipeId, setRecipeId] = useState('');
  const [freeText, setFreeText] = useState('');
  const [servings, setServings] = useState('');
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [moving, setMoving] = useState<{ entry: Entry; date: string; slot: Entry['slot']; swapWith: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string; title: string; x: number; y: number; overCell: string | null; overEntry: string | null } | null>(null);

  const filtered = useMemo(() => recipes.filter((r) => r.title.toLowerCase().includes(filter.toLowerCase())).slice(0, 100), [recipes, filter]);

  const save = () =>
    start(async () => {
      if (!target) return;
      const res = await addPlanEntry({ plan_date: target.date, slot: target.slot, recipe_id: recipeId || null, title: recipeId ? '' : freeText.trim(), servings: servings ? Number(servings) : null });
      if (res.ok) {
        setTarget(null);
        setRecipeId('');
        setFreeText('');
        setServings('');
        router.refresh();
      } else setMsg({ text: te(res.error), tone: 'error' });
    });

  const labelOf = (iso: string) => days.find((d) => d.iso === iso)?.label ?? iso;

  /** Sposta o scambia una voce; l'esito viene annunciato ai lettori di schermo. */
  const doMove = (entry: Entry, date: string, slot: Entry['slot'], swapWith?: string) =>
    start(async () => {
      const res = await movePlanEntry(swapWith ? { id: entry.id, swap_with: swapWith } : { id: entry.id, plan_date: date, slot });
      if (res.ok) {
        setMsg({ text: swapWith ? t('swapped', { title: entry.title }) : t('moved', { title: entry.title, slot: t(`slots.${slot}`), day: labelOf(date) }), tone: 'success' });
        router.refresh();
      } else setMsg({ text: te(res.error), tone: 'error' });
    });

  const openMove = (e: Entry) => setMoving({ entry: e, date: e.plan_date, slot: e.slot, swapWith: '' });
  const moveOccupants = moving ? entries.filter((e) => e.plan_date === moving.date && e.slot === moving.slot && e.id !== moving.entry.id) : [];
  const confirmMove = () => {
    if (!moving) return;
    const { entry, date, slot, swapWith } = moving;
    setMoving(null);
    if (!swapWith && date === entry.plan_date && slot === entry.slot) return;
    doMove(entry, date, slot, swapWith || undefined);
  };

  // Trascinamento con Pointer Events (mouse, touch, penna). Parte solo dalla maniglia, cosi' lo scorrimento
  // della pagina con il dito resta libero sul resto della scheda.
  const hit = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest<HTMLElement>('[data-cell-date]');
    const entryEl = el?.closest<HTMLElement>('[data-entry]');
    return { cell: cell ? { date: cell.dataset.cellDate as string, slot: cell.dataset.cellSlot as Entry['slot'] } : null, entryId: entryEl?.dataset.entry ?? null };
  };
  const onPointerDown = (ev: React.PointerEvent<HTMLButtonElement>, e: Entry) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setDrag({ id: e.id, title: e.title, x: ev.clientX, y: ev.clientY, overCell: null, overEntry: null });
  };
  const onPointerMove = (ev: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const h = hit(ev.clientX, ev.clientY);
    setDrag({ ...drag, x: ev.clientX, y: ev.clientY, overCell: h.cell ? `${h.cell.date}|${h.cell.slot}` : null, overEntry: h.entryId });
  };
  const onPointerUp = (ev: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const h = hit(ev.clientX, ev.clientY);
    const entry = entries.find((x) => x.id === drag.id);
    setDrag(null);
    if (!entry || !h.cell) return;
    if (h.entryId && h.entryId !== entry.id) return doMove(entry, h.cell.date, h.cell.slot, h.entryId);
    if (h.cell.date !== entry.plan_date || h.cell.slot !== entry.slot) doMove(entry, h.cell.date, h.cell.slot);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('dragHint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={pending || !entries.some((e) => e.recipe_id)}
          onClick={() =>
            start(async () => {
              const res = await addWeekToShopping(weekStart);
              setMsg(res.ok ? { text: t('addedToList', { added: res.data.added, merged: res.data.merged, recipes: res.data.recipes }), tone: 'success' } : { text: te(res.error), tone: 'error' });
            })
          }
        >
          <ShoppingBasket aria-hidden className="size-5" />
          {t('addToList')}
        </Button>
        <Link href="/shopping" className="inline-flex min-h-11 items-center text-basil underline underline-offset-4">
          {t('openList')}
        </Link>
        <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {days.map((d) => (
          <section key={d.iso} aria-labelledby={`d-${d.iso}`} className={cx('flex flex-col gap-2 rounded-[var(--radius-card)] border bg-surface p-3', d.today ? 'border-ink' : 'border-line')}>
            <h2 id={`d-${d.iso}`} className="font-display text-lg font-bold capitalize">
              {d.label}
            </h2>
            {slots.map((slot) => {
              const list = entries.filter((e) => e.plan_date === d.iso && e.slot === slot);
              return (
                <div key={slot} data-cell-date={d.iso} data-cell-slot={slot} className={cx('flex flex-col gap-1 rounded-lg', drag && drag.overCell === `${d.iso}|${slot}` && 'bg-basil/10 outline outline-2 outline-basil')}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted">{t(`slots.${slot}`)}</span>
                    <button type="button" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-sunk" aria-label={t('addTo', { slot: t(`slots.${slot}`), day: d.label })} onClick={() => setTarget({ date: d.iso, slot })}>
                      <Plus aria-hidden className="size-4" />
                    </button>
                  </div>
                  {list.map((e) => (
                    <div key={e.id} data-entry={e.id} className={cx('flex items-center gap-1 rounded-lg bg-saffron-wash px-2 py-1', drag?.id === e.id && 'opacity-40', drag && drag.id !== e.id && drag.overEntry === e.id && 'ring-2 ring-basil')}>
                      <button
                        type="button"
                        className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-full hover:bg-saffron/40 active:cursor-grabbing"
                        aria-label={t('dragHandle', { title: e.title })}
                        onPointerDown={(ev) => onPointerDown(ev, e)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={() => setDrag(null)}
                      >
                        <GripVertical aria-hidden className="size-4" />
                      </button>
                      {e.recipe_id ? (
                        <Link href={`/recipes/${e.recipe_id}`} className="min-h-11 min-w-0 flex-1 line-clamp-2 py-0.5 text-sm font-semibold hover:underline">
                          {e.title}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 line-clamp-2 text-sm">{e.title}</span>
                      )}
                      {e.servings && <span className="text-xs text-muted">×{Number(e.servings)}</span>}
                      <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-saffron/40" aria-label={t('moveEntry', { title: e.title })} onClick={() => openMove(e)}>
                        <MoveRight aria-hidden className="size-4" />
                      </button>
                      <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-saffron/40" aria-label={t('remove', { title: e.title })} onClick={() => start(async () => { await deletePlanEntry(e.id); router.refresh(); })}>
                        <X aria-hidden className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {drag && (
        <div aria-hidden className="pointer-events-none fixed z-50 max-w-56 -translate-x-1/2 -translate-y-1/2 truncate rounded-lg bg-ink px-3 py-1 text-sm font-semibold text-surface shadow-lg" style={{ left: drag.x, top: drag.y }}>
          {drag.title}
        </div>
      )}

      <Modal open={!!moving} onClose={() => setMoving(null)} title={moving ? t('moveTitle', { title: moving.entry.title }) : ''} closeLabel={tc('close')}>
        {moving && (
          <>
            <Field label={t('date')} htmlFor="mv-day">
              <Select id="mv-day" value={moving.date} onChange={(e) => setMoving({ ...moving, date: e.target.value, swapWith: '' })}>
                {days.map((d) => (
                  <option key={d.iso} value={d.iso}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('slot')} htmlFor="mv-slot">
              <Select id="mv-slot" value={moving.slot} onChange={(e) => setMoving({ ...moving, slot: e.target.value as Entry['slot'], swapWith: '' })}>
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {t(`slots.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {moveOccupants.length > 0 && (
              <Field label={t('moveOccupied')} htmlFor="mv-swap">
                <Select id="mv-swap" value={moving.swapWith} onChange={(e) => setMoving({ ...moving, swapWith: e.target.value })}>
                  <option value="">{t('moveAdd')}</option>
                  {moveOccupants.map((o) => (
                    <option key={o.id} value={o.id}>
                      {t('moveSwap', { title: o.title })}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Button variant="primary" disabled={pending} onClick={confirmMove}>
              {t('moveConfirm')}
            </Button>
          </>
        )}
      </Modal>

      <Modal open={!!target} onClose={() => setTarget(null)} title={target ? t('addTitle', { slot: t(`slots.${target.slot}`), day: days.find((d) => d.iso === target.date)?.label ?? '' }) : ''} closeLabel={tc('close')}>
        <Field label={t('searchRecipes')} htmlFor="rf">
          <Input id="rf" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </Field>
        <Field label={t('pickRecipe')} htmlFor="rp">
          <Select id="rp" value={recipeId} onChange={(e) => setRecipeId(e.target.value)} size={Math.min(8, Math.max(3, filtered.length + 1))} className="h-auto">
            <option value="">{t('noRecipeOption')}</option>
            {filtered.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </Select>
        </Field>
        {!recipeId && (
          <Field label={t('freeTextLabel')} htmlFor="ft">
            <Input id="ft" value={freeText} maxLength={200} onChange={(e) => setFreeText(e.target.value)} placeholder={t('freeTextPlaceholder')} />
          </Field>
        )}
        <Field label={t('servings')} htmlFor="sv">
          <Input id="sv" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Button variant="primary" disabled={pending || (!recipeId && !freeText.trim())} onClick={save}>
          {tc('add')}
        </Button>
      </Modal>
    </div>
  );
}
