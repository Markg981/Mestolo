import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getRecipeDetail } from '@/lib/data/recipes';
import { categoryLabel } from '@/lib/recipes/categories';
import { formatQuantity } from '@/lib/recipes/ingredient-parser';
import { formatMinutes } from '@/lib/recipes/duration';
import { UNIT_KEYS } from '@/lib/recipes/units';
import { PrintButton } from '../../PrintButton';

export default async function PrintRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getRecipeDetail(id);
  if (!d) notFound();
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const r = d.recipe;
  const unit = (u: string | null) => (!u ? '' : UNIT_KEYS.includes(u) ? t(`units.${u}`) : u);
  const labels = { h: t('common.hoursShort'), min: t('common.minShort') };
  const meta = [
    r.servings ? `${t('recipe.servings')}: ${Number(r.servings)}` : null,
    r.prep_minutes !== null ? `${t('recipe.prep')}: ${formatMinutes(r.prep_minutes, labels)}` : null,
    r.cook_minutes !== null ? `${t('recipe.cook')}: ${formatMinutes(r.cook_minutes, labels)}` : null,
    r.total_minutes !== null ? `${t('recipe.total')}: ${formatMinutes(r.total_minutes, labels)}` : null,
  ].filter(Boolean);
  return (
    <article className="flex flex-col gap-5">
      <PrintButton />
      <p className="text-sm">{categoryLabel(d.category, t)}</p>
      <h1 className="text-4xl font-extrabold">{r.title}</h1>
      {r.description && <p className="whitespace-pre-line">{r.description}</p>}
      {meta.length > 0 && <p className="text-sm">{meta.join('  |  ')}</p>}
      <div className="grid gap-8 sm:grid-cols-[1fr_1.6fr] print:grid-cols-[1fr_1.6fr]">
        <section>
          <h2 className="mb-2 text-xl font-bold">{t('recipe.ingredients')}</h2>
          <ul className="flex flex-col gap-1">
            {(r.ingredients ?? []).map((i, idx) => (
              <li key={idx}>
                <strong>{i.toTaste ? t('recipe.toTaste') : i.quantity !== null ? `${formatQuantity(i.quantity, locale, i.quantityMax)} ${unit(i.unit)}` : unit(i.unit)}</strong> {i.name}
                {i.note ? `, ${i.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-xl font-bold">{t('recipe.steps')}</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            {(r.steps ?? []).map((s, idx) => (
              <li key={idx} className="whitespace-pre-line">
                {s.text}
              </li>
            ))}
          </ol>
        </section>
      </div>
      {(r.source_url || r.source_name || r.original_author_name) && (
        <p className="border-t pt-3 text-sm">
          {t('print.source')}: {[r.original_author_name, r.source_attribution, r.source_name, r.source_url].filter(Boolean).join(', ')}
        </p>
      )}
      {d.note && (
        <p className="border-t pt-3 text-sm">
          {t('recipe.personalNote')}: {d.note}
        </p>
      )}
    </article>
  );
}
