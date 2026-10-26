import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getRecipeDetail } from '@/lib/data/recipes';
import { PageHeader, Badge } from '@/components/ui';
import { RestoreButton } from './RestoreButton';
import type { Ingredient, Step } from '@/lib/recipes/types';

type VersionRow = { version: number; change_source: string; change_note: string | null; created_at: string; snapshot: { title: string; ingredients: Ingredient[]; steps: Step[]; servings: number | null } };

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getRecipeDetail(id);
  if (!detail || !detail.isOwner) notFound();
  const [t, format] = await Promise.all([getTranslations('history'), getFormatter()]);
  const supabase = await createClient();
  const { data } = await supabase.from('recipe_versions').select('version, change_source, change_note, created_at, snapshot').eq('recipe_id', id).order('version', { ascending: false });
  const versions = (data as VersionRow[]) ?? [];
  const current = detail.recipe.version;

  return (
    <div>
      <PageHeader
        title={t('title')}
        lead={t('lead')}
        back={
          <Link href={`/recipes/${id}`} className="inline-flex min-h-11 items-center self-start text-basil underline underline-offset-4">
            {detail.recipe.title}
          </Link>
        }
      />
      <ol className="flex flex-col gap-3">
        {versions.map((v) => (
          <li key={v.version} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold">{t('version', { n: v.version })}</span>
                {v.version === current && <Badge tone="basil">{t('current')}</Badge>}
                {v.version === 1 && <Badge tone="saffron">{t('original')}</Badge>}
                <Badge>{t(`source.${v.change_source}` as 'source.edit')}</Badge>
              </div>
              <p className="text-sm text-muted">
                {format.dateTime(new Date(v.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
                {v.change_source === 'ai_suggestions' && v.change_note ? `, ${t('aiApplied', { n: Number(v.change_note) || 0 })}` : ''}
                {v.change_source === 'restore' && v.change_note ? `, ${t('restoredFrom', { v: v.change_note })}` : ''}
              </p>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-basil">{t('view')}</summary>
                <div className="grid gap-4 pb-2 text-sm sm:grid-cols-2">
                  <div>
                    <p className="font-semibold">{v.snapshot.title}</p>
                    <ul className="mt-1 list-disc pl-5">
                      {(v.snapshot.ingredients ?? []).map((i, idx) => (
                        <li key={idx}>{[i.quantity, i.unit, i.name].filter((x) => x !== null && x !== '').join(' ')}</li>
                      ))}
                    </ul>
                  </div>
                  <ol className="list-decimal pl-5">
                    {(v.snapshot.steps ?? []).map((s, idx) => (
                      <li key={idx}>{s.text}</li>
                    ))}
                  </ol>
                </div>
              </details>
            </div>
            {v.version !== current && <RestoreButton recipeId={id} version={v.version} />}
          </li>
        ))}
      </ol>
    </div>
  );
}
