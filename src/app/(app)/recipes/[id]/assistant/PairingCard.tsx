'use client';

import { useActionTransition } from '@/lib/run-action';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Sparkles, X } from 'lucide-react';
import { checkIngredientPairing, saveVariantWithIngredient, type PairingResponse } from '@/app/actions/ai';
import { AiSourceNote, type AiStatusProps } from '@/components/recipes/RecipeIslands';
import { Alert, Badge, Button, Card, Input, buttonClass, cx } from '@/components/ui';
import { RISKY_CAP, type PairingLevel } from '@/lib/recipes/pairing';

interface Props {
  recipeId: string;
  isOwner: boolean;
  status: AiStatusProps;
  ingredients: { name: string }[];
}

// Saffron and the fixed plum stay light/dark in both themes; basil and tomato flip, so porcelain text follows them.
const HERO: Record<PairingLevel, string> = {
  excellent: 'bg-basil text-porcelain',
  good: 'bg-basil text-porcelain',
  bold: 'bg-saffron text-[#3d1a2e]',
  poor: 'bg-tomato text-porcelain',
};
const PILL: Record<PairingLevel, string> = {
  excellent: 'bg-saffron text-[#3d1a2e]',
  good: 'bg-saffron text-[#3d1a2e]',
  bold: 'bg-[#3d1a2e] text-[#f8ebcf]',
  poor: 'bg-saffron text-[#3d1a2e]',
};

/** «Si sposa bene?»: how well one extra ingredient fits the tested recipe. */
export function PairingCard(p: Props) {
  const t = useTranslations('assistant.pairing');
  const ta = useTranslations('assistant');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useActionTransition();
  const [addition, setAddition] = useState('');
  const [res, setRes] = useState<PairingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ingName = (i: number) => p.ingredients[i]?.name ?? '';

  const check = () =>
    start(async () => {
      setError(null);
      if (!addition.trim()) {
        setError(t('empty'));
        return;
      }
      const r = await checkIngredientPairing(p.recipeId, addition);
      if (r.ok) setRes(r.data);
      else setError(r.detail === 'not_food' ? t('notFood') : te(r.error));
    });

  const saveVariant = () =>
    start(async () => {
      if (!res) return;
      setError(null);
      const name = res.assessment.ingredient || addition.trim();
      const r = await saveVariantWithIngredient(p.recipeId, res.pairingId, t('variantSuffix', { name }));
      if (r.ok) router.push(`/recipes/${r.data.id}?created=1`);
      else setError(r.detail === 'stale' ? t('stale') : r.detail === 'duplicate' ? t('duplicate') : te(r.error));
    });

  const reset = () => {
    setRes(null);
    setError(null);
    setAddition('');
  };

  const a = res?.assessment;

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">{t('title')}</h2>
      <p className="text-muted">{t('lead')}</p>
      {!p.status.available ? (
        <Alert tone="info" action={<Link href="/settings/ai" className={buttonClass('secondary', 'sm')}>{ta('configure')}</Link>}>
          {t('unavailable')}
        </Alert>
      ) : (
        !a && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              check();
            }}
          >
            <AiSourceNote status={p.status} />
            <label className="flex flex-col gap-1">
              <span className="font-semibold">{t('label')}</span>
              <span className="flex flex-col gap-2 sm:flex-row">
                <Input className="flex-1" value={addition} maxLength={200} onChange={(e) => setAddition(e.target.value)} placeholder={t('placeholder')} />
                <Button type="submit" variant="primary" disabled={pending}>
                  <Sparkles aria-hidden className="size-5" />
                  {pending ? t('checking') : t('check')}
                </Button>
              </span>
            </label>
          </form>
        )
      )}
      {error && <Alert tone="error">{error}</Alert>}

      {a && res && (
        <div className="flex flex-col gap-5" aria-live="polite">
          <div className={cx('wave-b -mx-5 flex flex-col gap-3 px-6 pb-14 pt-6 sm:-mx-6 sm:px-8', HERO[a.level])}>
            <p className="text-xs font-bold uppercase tracking-[0.14em] opacity-85">{a.ingredient || addition}</p>
            <p className="font-display text-4xl leading-tight font-semibold text-balance sm:text-5xl">{t(`levels.${a.level}`)}</p>
            <p className="flex flex-wrap items-center gap-2">
              <span className={cx('tabular rounded-full px-4 py-1.5 text-lg font-bold', PILL[a.level])}>
                {a.score}/100 · {t(`confidence.${a.confidence}`)}
              </span>
            </p>
            {a.summary && <p className="max-w-prose text-[1.05rem]">{a.summary}</p>}
          </div>

          {a.risky && (
            <Alert tone="error">
              <span className="inline-flex items-start gap-2">
                <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
                {t('risky', { cap: RISKY_CAP })}
              </span>
            </Alert>
          )}
          {a.already_in_recipe !== null && <Alert tone="info">{t('already', { name: ingName(a.already_in_recipe) })}</Alert>}

          <ul className="flex flex-col gap-3">
            {a.criteria.map((c) => {
              const r = Math.round(c.rating);
              return (
                <li key={c.key} className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_auto_1fr] sm:items-baseline">
                  <span className="font-semibold">{t(`criteria.${c.key}`)}</span>
                  <span role="img" aria-label={t('ratingOf', { n: r })} className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map((d) => (
                      <span key={d} className={cx('size-3 rounded-full', d <= r ? 'bg-saffron' : 'bg-sunk ring-1 ring-inset ring-line-strong/40')} />
                    ))}
                  </span>
                  {c.note && <span className="text-[0.95rem] text-muted">{c.note}</span>}
                </li>
              );
            })}
          </ul>

          {(a.pairs_with.length > 0 || a.clashes_with.length > 0) && (
            <div className="flex flex-col gap-3">
              {a.pairs_with.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-muted">{t('pairsWith')}</p>
                  <ul className="flex flex-wrap gap-2">
                    {a.pairs_with.map((l) => (
                      <li key={l.ingredientIndex} title={l.reason} className="inline-flex items-center gap-1.5 rounded-full bg-basil-wash px-3 py-1 font-semibold text-basil-deep ring-1 ring-inset ring-basil/40">
                        <Check aria-hidden className="size-4" />
                        {ingName(l.ingredientIndex)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {a.clashes_with.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-muted">{t('clashesWith')}</p>
                  <ul className="flex flex-col gap-2">
                    {a.clashes_with.map((l) => (
                      <li key={l.ingredientIndex} className="flex flex-wrap items-baseline gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-tomato-wash px-3 py-1 font-semibold text-tomato-deep ring-1 ring-inset ring-tomato/40">
                          <X aria-hidden className="size-4" />
                          {ingName(l.ingredientIndex)}
                        </span>
                        {l.reason && <span className="text-[0.95rem] text-muted">{l.reason}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {(a.quantity_hint || a.when_to_add || a.role) && (
            <div className="flex flex-col gap-2 rounded-[1.75rem] bg-saffron-wash p-5">
              <p className="font-display text-xl font-semibold">{t('howTitle')}</p>
              <dl className="grid gap-1 sm:grid-cols-[7rem_1fr]">
                {a.role && (
                  <>
                    <dt className="text-muted">{t('role')}</dt>
                    <dd>{a.role}</dd>
                  </>
                )}
                {a.quantity_hint && (
                  <>
                    <dt className="text-muted">{t('quantity')}</dt>
                    <dd>{a.quantity_hint}</dd>
                  </>
                )}
                {a.when_to_add && (
                  <>
                    <dt className="text-muted">{t('when')}</dt>
                    <dd>
                      {a.stepIndex !== null && <Badge tone="saffron">{t('atStep', { n: a.stepIndex + 1 })}</Badge>} {a.when_to_add}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {a.warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-muted">{t('warningsTitle')}</p>
              <ul className="list-disc pl-5 text-[0.95rem]">
                {a.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {p.isOwner && a.already_in_recipe === null && (
              <Button variant="primary" disabled={pending} onClick={saveVariant}>
                {ta('saveVariant')}
              </Button>
            )}
            <Button disabled={pending} onClick={reset}>
              {t('tryAnother')}
            </Button>
          </div>
          <p className="text-sm text-muted">{t('disclaimer')}</p>
          <p className="text-sm text-muted">{t('source', { provider: res.aiSource.providerName })}</p>
        </div>
      )}
    </Card>
  );
}
