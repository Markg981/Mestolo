'use client';

import { useActionTransition } from '@/lib/run-action';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { analyzeRecipe, applyAnalysis, suggestSubstitutions, type AnalysisResponse, type SubstitutionResponse } from '@/app/actions/ai';
import { AiSourceNote, type AiStatusProps } from '@/components/recipes/RecipeIslands';
import { Alert, Badge, Button, Card, Input, buttonClass, cx } from '@/components/ui';
import { formatQuantity } from '@/lib/recipes/ingredient-parser';
import { UNIT_KEYS } from '@/lib/recipes/units';
import type { Suggestion } from '@/lib/recipes/suggestions';
import { PairingCard } from './PairingCard';

interface Props {
  recipeId: string;
  isOwner: boolean;
  status: AiStatusProps;
  ingredients: { name: string; quantity: number | null; unit: string | null }[];
  steps: string[];
  times: { prep_minutes: number | null; cook_minutes: number | null; total_minutes: number | null };
}

export function Assistant(p: Props) {
  const t = useTranslations('assistant');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const tu = useTranslations('units');
  const tr = useTranslations('recipe');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useActionTransition();
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [missing, setMissing] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [useAi, setUseAi] = useState(p.status.available);
  const [subs, setSubs] = useState<SubstitutionResponse | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);

  const unit = (u: string | null) => (!u ? '' : UNIT_KEYS.includes(u) ? tu(u) : u);
  const ingLabel = (i: { name: string; quantity: number | null; unit: string | null }) =>
    [i.quantity !== null ? formatQuantity(i.quantity, locale) : '', unit(i.unit), i.name].filter(Boolean).join(' ');

  const applicable = analysis?.analysis.suggestions.filter((s) => s.type !== 'idea') ?? [];
  const ideas = analysis?.analysis.suggestions.filter((s): s is Extract<Suggestion, { type: 'idea' }> => s.type === 'idea') ?? [];

  const before = (s: Suggestion): string => {
    switch (s.type) {
      case 'step_rewrite':
        return p.steps[s.stepIndex] ?? s.before;
      case 'ingredient_fix':
        return p.ingredients[s.ingredientIndex] ? ingLabel(p.ingredients[s.ingredientIndex]) : s.before;
      case 'ingredient_add':
        return t('nothing');
      case 'time_estimate':
        return s.before !== null ? `${s.before} ${tc('minShort')}` : tr('notDetected');
      default:
        return '';
    }
  };
  const after = (s: Suggestion): string => {
    switch (s.type) {
      case 'step_rewrite':
        return s.after;
      case 'ingredient_fix':
      case 'ingredient_add':
        return ingLabel(s.after);
      case 'time_estimate':
        return `${s.after} ${tc('minShort')}`;
      default:
        return '';
    }
  };
  const where = (s: Suggestion): string => {
    if (s.type === 'step_rewrite') return t('whereStep', { n: s.stepIndex + 1 });
    if (s.type === 'ingredient_fix') return t('whereIngredient', { n: s.ingredientIndex + 1 });
    if (s.type === 'time_estimate') return tr(s.field === 'prep_minutes' ? 'prep' : s.field === 'cook_minutes' ? 'cook' : 'total');
    return '';
  };

  const runAnalysis = () =>
    start(async () => {
      setError(null);
      setDone(null);
      const res = await analyzeRecipe(p.recipeId);
      if (res.ok) {
        setAnalysis(res.data);
        setSelected([]);
      } else setError(te(res.error));
    });

  const apply = (mode: 'apply' | 'variant') =>
    start(async () => {
      if (!analysis) return;
      setError(null);
      const res = await applyAnalysis(p.recipeId, analysis.analysisId, selected, mode, t('variantSuffix'));
      if (!res.ok) {
        setError(res.detail === 'stale' ? t('stale') : te(res.error));
        return;
      }
      if (mode === 'variant') router.push(`/recipes/${res.data.id}?created=1`);
      else {
        setDone(t('appliedOk', { n: res.data.applied }));
        setAnalysis(null);
        router.refresh();
      }
    });

  const findSubs = () =>
    start(async () => {
      setSubsError(null);
      const list = [...missing, ...extra.split(',').map((x) => x.trim()).filter(Boolean)];
      if (!list.length) {
        setSubsError(t('subsPickFirst'));
        return;
      }
      const res = await suggestSubstitutions(p.recipeId, list, useAi && p.status.available);
      if (res.ok) setSubs(res.data);
      else setSubsError(te(res.error));
    });

  return (
    <div className="flex flex-col gap-10">
      <Card className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">{t('analysisTitle')}</h2>
        <p className="text-muted">{t('analysisLead')}</p>
        {!p.isOwner ? (
          <Alert tone="info">{t('ownerOnly')}</Alert>
        ) : (
          <>
            <AiSourceNote status={p.status} />
            {!p.status.available && (
              <Alert tone="info" action={<Link href="/settings/ai" className={buttonClass('secondary', 'sm')}>{t('configure')}</Link>}>
                {t('unavailable')}
              </Alert>
            )}
            {!analysis && (
              <div>
                <Button variant="primary" disabled={pending || !p.status.available} onClick={runAnalysis}>
                  <Sparkles aria-hidden className="size-5" />
                  {pending ? t('analyzing') : t('analyze')}
                </Button>
              </div>
            )}
          </>
        )}
        {done && <Alert tone="success" action={<Link href={`/recipes/${p.recipeId}/history`} className={buttonClass('secondary', 'sm')}>{t('openHistory')}</Link>}>{done}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {analysis && (
          <div className="flex flex-col gap-4">
            {analysis.analysis.summary && <p className="rounded-2xl bg-sunk p-4">{analysis.analysis.summary}</p>}
            {!applicable.length && !ideas.length && <p>{t('noSuggestions')}</p>}
            {applicable.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t('selectedCount', { n: selected.length, total: applicable.length })}</span>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(applicable.map((s) => s.id))}>
                    {t('selectAll')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                    {t('selectNone')}
                  </Button>
                </div>
                <ul className="flex flex-col gap-3">
                  {applicable.map((s) => {
                    const checked = selected.includes(s.id);
                    return (
                      <li key={s.id} className={cx('rounded-2xl border-2 bg-surface p-4', checked ? 'border-basil' : 'border-line')}>
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 size-5 accent-[var(--basil)]"
                            checked={checked}
                            onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-2">
                            <span className="flex flex-wrap items-center gap-2">
                              <Badge tone="basil">{t(`types.${s.type}`)}</Badge>
                              {where(s) && <span className="text-sm text-muted">{where(s)}</span>}
                              {s.type === 'time_estimate' && <Badge tone="saffron">{t('estimate')}</Badge>}
                            </span>
                            <span className="grid gap-2 sm:grid-cols-2">
                              <span className="rounded-xl bg-sunk p-3">
                                <span className="block text-xs font-semibold text-muted">{t('original')}</span>
                                <span className="whitespace-pre-line">{before(s)}</span>
                              </span>
                              <span className="rounded-xl border border-basil/40 bg-basil-wash p-3">
                                <span className="block text-xs font-semibold text-basil">{t('proposal')}</span>
                                <span className="whitespace-pre-line">{after(s)}</span>
                              </span>
                            </span>
                            {'reason' in s && s.reason && <span className="text-sm text-muted">{s.reason}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {ideas.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-bold">{t('ideasTitle')}</h3>
                <p className="text-sm text-muted">{t('ideasLead')}</p>
                <ul className="flex flex-col gap-2">
                  {ideas.map((i) => (
                    <li key={i.id} className="rounded-2xl border border-line bg-surface p-3">
                      <p className="font-semibold">{i.title}</p>
                      <p className="text-[0.97rem]">{i.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button variant="primary" disabled={pending || !selected.length} onClick={() => apply('apply')}>
                {t('applySelected')}
              </Button>
              <Button disabled={pending || !selected.length} onClick={() => apply('variant')}>
                {t('saveVariant')}
              </Button>
              <Button variant="ghost" onClick={() => setAnalysis(null)}>
                {t('keepOriginal')}
              </Button>
            </div>
            <p className="text-sm text-muted">{t('historyNote')}</p>
          </div>
        )}
      </Card>

      <PairingCard recipeId={p.recipeId} isOwner={p.isOwner} status={p.status} ingredients={p.ingredients} />

      <Card className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">{t('subsTitle')}</h2>
        <p className="text-muted">{t('subsLead')}</p>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-semibold">{t('subsPick')}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {p.ingredients.map((i, idx) => (
              <label key={idx} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-sunk">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--basil)]"
                  checked={missing.includes(i.name)}
                  onChange={(e) => setMissing((m) => (e.target.checked ? [...m, i.name] : m.filter((x) => x !== i.name)))}
                />
                {i.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t('subsOther')}</span>
          <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('subsOtherPlaceholder')} />
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 accent-[var(--basil)]" checked={useAi && p.status.available} disabled={!p.status.available} onChange={(e) => setUseAi(e.target.checked)} />
          <span>
            <span className="font-semibold">{t('subsUseAi')}</span>
            <AiSourceNote status={p.status} />
          </span>
        </label>
        <div>
          <Button variant="primary" disabled={pending} onClick={findSubs}>
            {pending ? t('subsFinding') : t('subsFind')}
          </Button>
        </div>
        {subsError && <Alert tone="error">{subsError}</Alert>}

        {subs && (
          <div className="flex flex-col gap-4" aria-live="polite">
            <Alert tone="warn">{t('disclaimer')}</Alert>
            {subs.builtin.map((b) => (
              <div key={`b-${b.ingredient}`} className="flex flex-col gap-2">
                <h3 className="text-lg font-bold">{b.ingredient}</h3>
                <p className="text-sm font-semibold text-muted">{t('builtinTitle')}</p>
                {b.alternatives.length ? (
                  <ul className="flex flex-col gap-2">
                    {b.alternatives.map((a, i) => (
                      <SubCard key={i} name={a.name} qty={a.quantity_hint} effect={a.effect} limits={a.limitations} risky={false} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{t('noBuiltin')}</p>
                )}
              </div>
            ))}
            {subs.ai && (
              <div className="flex flex-col gap-3 border-t border-line pt-4">
                <p className="font-semibold">{t('aiTitle', { provider: subs.aiSource?.providerName ?? '' })}</p>
                {subs.ai.ingredients.map((x) => (
                  <div key={`ai-${x.ingredient}`} className="flex flex-col gap-2">
                    <h3 className="text-lg font-bold">{x.ingredient}</h3>
                    <ul className="flex flex-col gap-2">
                      {x.alternatives.map((a, i) => (
                        <SubCard key={i} name={a.name} qty={a.quantity_hint} effect={a.effect} limits={a.limitations} risky={a.risky} />
                      ))}
                    </ul>
                  </div>
                ))}
                {subs.ai.general_warning && <p className="text-sm text-muted">{subs.ai.general_warning}</p>}
              </div>
            )}
            {subs.aiError && <Alert tone="info">{t('aiFailed', { error: te(subs.aiError) })}</Alert>}
          </div>
        )}
      </Card>
    </div>
  );
}

function SubCard({ name, qty, effect, limits, risky }: { name: string; qty: string; effect: string; limits: string; risky: boolean }) {
  const t = useTranslations('assistant');
  return (
    <li className="rounded-2xl border border-line bg-surface p-3">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        {name}
        {risky && (
          <Badge tone="tomato">
            <AlertTriangle aria-hidden className="size-3.5" />
            {t('risky')}
          </Badge>
        )}
      </p>
      <dl className="mt-1 grid gap-1 text-[0.95rem] sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted">{t('quantityHint')}</dt>
        <dd>{qty}</dd>
        <dt className="text-muted">{t('effect')}</dt>
        <dd>{effect}</dd>
        <dt className="text-muted">{t('limits')}</dt>
        <dd>{limits}</dd>
      </dl>
    </li>
  );
}
