'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarPlus, Copy, Download, Flag, FolderPlus, GitBranch, Heart, History, Pencil, Printer, Sparkles, Trash2, UserX } from 'lucide-react';
import { copyRecipe, deleteRecipe, setPublicPage, setVisibility, toggleFavorite } from '@/app/actions/recipes';
import { setRecipeInCollection, createCollection } from '@/app/actions/organize';
import { addPlanEntry } from '@/app/actions/planning';
import { blockUser, reportRecipe } from '@/app/actions/social';
import { LiveMessage, Modal } from '../client-ui';
import { Button, Field, Input, Select, Textarea, buttonClass } from '../ui';
import type { Visibility } from '@/lib/recipes/types';

interface Props {
  recipeId: string;
  isOwner: boolean;
  ownerId: string;
  ownerUsername: string | null;
  isFavorite: boolean;
  visibility: Visibility;
  publicPageEnabled: boolean;
  publicSlug: string | null;
  servings: number | null;
  collections: { id: string; name: string }[];
  memberOf: string[];
}

type Dialog = null | 'delete' | 'collections' | 'plan' | 'report' | 'block';

export function RecipeActions(p: Props) {
  const t = useTranslations('recipe');
  const tc = useTranslations('common');
  const tv = useTranslations('visibility');
  const te = useTranslations('errors');
  const tp = useTranslations('plan');
  const tpp = useTranslations('publicPage');
  const tr = useTranslations('report');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [fav, setFav] = useState(p.isFavorite);
  const [vis, setVis] = useState<Visibility>(p.visibility);
  const [pubOn, setPubOn] = useState(p.publicPageEnabled);
  const [pubSlug, setPubSlug] = useState(p.publicSlug);
  const [member, setMember] = useState<string[]>(p.memberOf);
  const [cols, setCols] = useState(p.collections);
  const [newCol, setNewCol] = useState('');
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [planSlot, setPlanSlot] = useState('dinner');
  const [planServings, setPlanServings] = useState(p.servings ? String(p.servings) : '');
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (success) setMsg({ text: success, tone: 'success' });
        after?.();
      } else setMsg({ text: te((res as { error: string }).error), tone: 'error' });
    });

  const iconBtn = 'size-4';

  return (
    <div className="no-print flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {p.isOwner && (
          <Link href={`/recipes/${p.recipeId}/edit`} className={buttonClass('primary', 'sm')}>
            <Pencil aria-hidden className={iconBtn} />
            {tc('edit')}
          </Link>
        )}
        <Link href={`/recipes/${p.recipeId}/assistant`} className={buttonClass('secondary', 'sm')}>
          <Sparkles aria-hidden className={iconBtn} />
          {p.isOwner ? t('assistant') : t('substitutions')}
        </Link>
        {!p.isOwner && (
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await copyRecipe(p.recipeId, 'copy');
                if (res.ok) router.push(`/recipes/${res.data.id}?copied=1`);
                else setMsg({ text: te(res.error), tone: 'error' });
              })
            }
          >
            <Copy aria-hidden className={iconBtn} />
            {t('saveCopy')}
          </Button>
        )}
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await copyRecipe(p.recipeId, 'variant', t('variantSuffix'));
              if (res.ok) router.push(`/recipes/${res.data.id}/edit`);
              else setMsg({ text: te(res.error), tone: 'error' });
            })
          }
        >
          <GitBranch aria-hidden className={iconBtn} />
          {t('createVariant')}
        </Button>
        <Button size="sm" aria-pressed={fav} disabled={pending} onClick={() => run(async () => toggleFavorite(p.recipeId, !fav), undefined, () => setFav(!fav))}>
          <Heart aria-hidden className={iconBtn} fill={fav ? 'currentColor' : 'none'} />
          {fav ? t('unfavorite') : t('favorite')}
        </Button>
        <Button size="sm" onClick={() => setDialog('collections')}>
          <FolderPlus aria-hidden className={iconBtn} />
          {t('addToCollection')}
        </Button>
        <Button size="sm" onClick={() => setDialog('plan')}>
          <CalendarPlus aria-hidden className={iconBtn} />
          {t('addToPlan')}
        </Button>
        <Link href={`/print/recipes/${p.recipeId}`} className={buttonClass('secondary', 'sm')} target="_blank">
          <Printer aria-hidden className={iconBtn} />
          {t('print')}
        </Link>
      </div>

      <details className="rounded-xl border border-line bg-surface px-4">
        <summary className="min-h-11 cursor-pointer py-2.5 font-semibold">{t('moreActions')}</summary>
        <div className="flex flex-col gap-3 pb-4">
          {p.isOwner && (
            <label className="flex flex-col gap-1">
              <span className="font-semibold">{tv('label')}</span>
              <Select
                value={vis}
                disabled={pending}
                onChange={(e) => {
                  const v = e.target.value as Visibility;
                  run(async () => setVisibility(p.recipeId, v), tv('changed', { v: tv(v) }), () => {
                    setVis(v);
                    if (v !== 'public') setPubOn(false);
                  });
                }}
              >
                {(['private', 'friends', 'public'] as const).map((v) => (
                  <option key={v} value={v}>
                    {tv(v)} — {tv(`${v}Hint`)}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {p.isOwner && (
            <div className="flex flex-col gap-1">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--basil)]"
                  checked={pubOn}
                  disabled={pending || vis !== 'public'}
                  aria-describedby="pubpage-hint"
                  onChange={(e) => {
                    const on = e.target.checked;
                    start(async () => {
                      const res = await setPublicPage(p.recipeId, on);
                      if (res.ok) {
                        setPubOn(on);
                        setPubSlug(res.data.slug);
                        setMsg({ text: on ? tpp('enabled') : tpp('disabled'), tone: 'success' });
                      } else setMsg({ text: te(res.error), tone: 'error' });
                    });
                  }}
                />
                <span className="font-semibold">{tpp('toggleLabel')}</span>
              </label>
              <p id="pubpage-hint" className="text-sm text-muted">
                {vis === 'public' ? tpp('toggleHint') : tpp('needsPublic')}
              </p>
              {pubOn && pubSlug && (
                <Link href={`/r/${pubSlug}`} target="_blank" className="text-sm font-semibold text-basil underline underline-offset-4">
                  {tpp('viewPage')}
                </Link>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={`/api/recipes/${p.recipeId}/export`} className={buttonClass('secondary', 'sm')}>
              <Download aria-hidden className={iconBtn} />
              {t('exportJson')}
            </a>
            <a href={`/api/recipes/${p.recipeId}/export?format=schema`} className={buttonClass('secondary', 'sm')}>
              <Download aria-hidden className={iconBtn} />
              {t('exportSchema')}
            </a>
            {p.isOwner && (
              <Link href={`/recipes/${p.recipeId}/history`} className={buttonClass('secondary', 'sm')}>
                <History aria-hidden className={iconBtn} />
                {t('history')}
              </Link>
            )}
            {p.isOwner && (
              <Button size="sm" variant="ghost" className="text-tomato" onClick={() => setDialog('delete')}>
                <Trash2 aria-hidden className={iconBtn} />
                {tc('delete')}
              </Button>
            )}
            {!p.isOwner && (
              <Button size="sm" variant="ghost" onClick={() => setDialog('report')}>
                <Flag aria-hidden className={iconBtn} />
                {t('report')}
              </Button>
            )}
            {!p.isOwner && (
              <Button size="sm" variant="ghost" onClick={() => setDialog('block')}>
                <UserX aria-hidden className={iconBtn} />
                {t('blockAuthor')}
              </Button>
            )}
          </div>
        </div>
      </details>

      <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />

      <Modal open={dialog === 'delete'} onClose={() => setDialog(null)} title={t('deleteConfirmTitle')} closeLabel={tc('close')}>
        <p>{t('deleteConfirm')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteRecipe(p.recipeId);
                if (res.ok) router.push('/recipes?deleted=1');
                else setMsg({ text: te(res.error), tone: 'error' });
              })
            }
          >
            {pending ? tc('deleting') : tc('delete')}
          </Button>
          <Button onClick={() => setDialog(null)}>{tc('cancel')}</Button>
        </div>
      </Modal>

      <Modal open={dialog === 'collections'} onClose={() => setDialog(null)} title={t('addToCollection')} closeLabel={tc('close')}>
        {cols.length ? (
          <ul className="flex flex-col gap-1">
            {cols.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-sunk">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--basil)]"
                    checked={member.includes(c.id)}
                    disabled={pending}
                    onChange={(e) => {
                      const on = e.target.checked;
                      run(async () => setRecipeInCollection(c.id, p.recipeId, on), undefined, () => setMember((m) => (on ? [...m, c.id] : m.filter((x) => x !== c.id))));
                    }}
                  />
                  {c.name}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('noCollections')}</p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newCol.trim();
            if (!name) return;
            start(async () => {
              const res = await createCollection(name);
              if (res.ok) {
                await setRecipeInCollection(res.data.id, p.recipeId, true);
                setCols((c) => [{ id: res.data.id, name }, ...c]);
                setMember((m) => [...m, res.data.id]);
                setNewCol('');
              } else setMsg({ text: te(res.error), tone: 'error' });
            });
          }}
        >
          <label htmlFor="newcol" className="sr-only">
            {t('newCollection')}
          </label>
          <Input id="newcol" value={newCol} maxLength={80} onChange={(e) => setNewCol(e.target.value)} placeholder={t('newCollection')} />
          <button type="submit" className={buttonClass('secondary')} disabled={pending}>
            {tc('add')}
          </button>
        </form>
      </Modal>

      <Modal open={dialog === 'plan'} onClose={() => setDialog(null)} title={t('addToPlan')} closeLabel={tc('close')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tp('date')} htmlFor="pdate">
            <Input id="pdate" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          </Field>
          <Field label={tp('slot')} htmlFor="pslot">
            <Select id="pslot" value={planSlot} onChange={(e) => setPlanSlot(e.target.value)}>
              {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((s) => (
                <option key={s} value={s}>
                  {tp(`slots.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tp('servings')} htmlFor="pserv">
            <Input id="pserv" inputMode="numeric" value={planServings} onChange={(e) => setPlanServings(e.target.value.replace(/[^\d]/g, ''))} />
          </Field>
        </div>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            run(
              async () => addPlanEntry({ plan_date: planDate, slot: planSlot, recipe_id: p.recipeId, servings: planServings ? Number(planServings) : null }),
              t('addedToPlan'),
              () => setDialog(null),
            )
          }
        >
          {t('addToPlan')}
        </Button>
      </Modal>

      <Modal open={dialog === 'report'} onClose={() => setDialog(null)} title={tr('title')} closeLabel={tc('close')}>
        <Field label={tr('reason')} htmlFor="reason">
          <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            {(['spam', 'offensive', 'copyright', 'unsafe', 'other'] as const).map((r) => (
              <option key={r} value={r}>
                {tr(`reasons.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-muted">{tr('note')}</p>
        <Field label={tr('details')} htmlFor="details">
          <Textarea id="details" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <Button variant="primary" disabled={pending} onClick={() => run(async () => reportRecipe({ recipeId: p.recipeId, reason, details }), tr('sent'), () => setDialog(null))}>
          {tr('send')}
        </Button>
      </Modal>

      <Modal open={dialog === 'block'} onClose={() => setDialog(null)} title={t('blockAuthor')} closeLabel={tc('close')}>
        <p>{t('blockConfirm', { name: p.ownerUsername ? `@${p.ownerUsername}` : '' })}</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await blockUser(p.ownerId);
                if (res.ok) router.push('/discover');
                else setMsg({ text: te(res.error), tone: 'error' });
              })
            }
          >
            {t('blockAuthor')}
          </Button>
          <Button onClick={() => setDialog(null)}>{tc('cancel')}</Button>
        </div>
      </Modal>
    </div>
  );
}
