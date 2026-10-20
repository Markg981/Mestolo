import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChefHat, Clock, ExternalLink, Users } from 'lucide-react';
import { createClient, getUser } from '@/lib/supabase/server';
import { getRecipeDetail, listCollections } from '@/lib/data/recipes';
import { capabilityStatus } from '@/lib/ai/service';
import { categoryLabel } from '@/lib/recipes/categories';
import { isTranslationFresh, mergeTranslation, translatedPayloadSchema } from '@/lib/recipes/translation';
import { formatMinutes } from '@/lib/recipes/duration';
import { isLocale } from '@/i18n/config';
import { RecipeImage } from '@/components/recipes/RecipeImage';
import { IngredientList } from '@/components/recipes/IngredientList';
import { RecipeActions } from '@/components/recipes/RecipeActions';
import { ImagePrompt, NoteEditor, TranslateBanner, type AiStatusProps } from '@/components/recipes/RecipeIslands';
import { RecipeRating } from '@/components/recipes/RecipeRating';
import { CookPrefetch } from '@/components/cooking/CookPrefetch';
import { Alert, Badge, LinkButton } from '@/components/ui';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getRecipeDetail(id);
  return { title: d?.recipe.title ?? 'Mestolo' };
}

const NONE: AiStatusProps = { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null };

export default async function RecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string; created?: string; saved?: string; copied?: string; image?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getRecipeDetail(id);
  if (!detail) notFound();
  const [t, locale, user, collections] = await Promise.all([getTranslations(), getLocale(), getUser(), listCollections()]);
  const { recipe, images, category, owner, isOwner } = detail;
  const supabase = await createClient();
  const { data: myRating } = isOwner ? { data: null } : await supabase.from('recipe_ratings').select('stars').eq('recipe_id', id).eq('user_id', user!.id).maybeSingle();

  // Translation (cached, tied to the content hash; the original is never modified)
  const origLang = recipe.original_language.slice(0, 2);
  const wantLang = sp.lang && isLocale(sp.lang) ? sp.lang : null;
  let view = { title: recipe.title, description: recipe.description, ingredients: recipe.ingredients ?? [], steps: recipe.steps ?? [] };
  let translationState: 'none' | 'original' | 'translation' | 'stale' = origLang !== locale ? 'original' : 'none';
  if (wantLang && wantLang !== origLang) {
    const { data: tr } = await supabase.from('recipe_translations').select('content, source_hash').eq('recipe_id', id).eq('locale', wantLang).maybeSingle();
    const parsed = tr ? translatedPayloadSchema.safeParse(tr.content) : null;
    if (tr && parsed?.success && isTranslationFresh(tr.source_hash, recipe.content_hash)) {
      try {
        view = mergeTranslation(view, parsed.data);
        translationState = 'translation';
      } catch {
        translationState = 'stale';
      }
    } else if (tr) translationState = 'stale';
  }
  const targetLang = wantLang ?? locale;
  const needsAiStatus = translationState !== 'none' && translationState !== 'translation';
  const [translateStatus, imageStatus] = await Promise.all([
    needsAiStatus && user ? capabilityStatus(user.id, 'text', 'translate').catch(() => NONE) : Promise.resolve(NONE),
    isOwner && !images.length && user ? capabilityStatus(user.id, 'image', 'image').catch(() => NONE) : Promise.resolve(NONE),
  ]);
  const names = new Intl.DisplayNames([locale], { type: 'language' });

  const [parent, copiedFrom] = await Promise.all([
    recipe.parent_recipe_id ? supabase.from('recipes').select('id, title').eq('id', recipe.parent_recipe_id).maybeSingle() : Promise.resolve({ data: null }),
    recipe.copied_from_recipe_id ? supabase.from('recipes').select('id').eq('id', recipe.copied_from_recipe_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const cover = images[0] ?? null;
  const labels = { h: t('common.hoursShort'), min: t('common.minShort') };
  const times = [
    ['prep', recipe.prep_minutes, 'prep_minutes'],
    ['cook', recipe.cook_minutes, 'cook_minutes'],
    ['total', recipe.total_minutes, 'total_minutes'],
  ] as const;
  const flags = recipe.field_flags ?? {};

  return (
    <article className="flex flex-col gap-8">
      {sp.created && <Alert tone="success">{t('recipe.created')}</Alert>}
      {sp.saved && <Alert tone="success">{t('recipe.saved')}</Alert>}
      {sp.copied && <Alert tone="success">{t('recipe.copied')}</Alert>}
      {sp.image === 'failed' && <Alert tone="warn">{t('recipe.imageFailed')}</Alert>}
      {recipe.is_hidden && isOwner && (
        <Alert tone="error" title={t('recipe.hiddenTitle')}>
          {t('recipe.hiddenLead')}
        </Alert>
      )}

      <header className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <div className="flex flex-col gap-3">
          <div className="aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-card)] bg-sunk">
            <RecipeImage imageId={cover?.id ?? null} title={recipe.title} alt={cover?.alt_text || recipe.title} size="full" className="h-full w-full" priority />
          </div>
          {cover?.kind === 'ai_generated' && <Badge tone="ink">{t('image.aiLabel')}</Badge>}
          {cover?.kind === 'imported' && <p className="text-sm text-muted">{t('image.importedCaption', { source: cover.attribution ?? '' })}</p>}
          {isOwner && !images.length && <ImagePrompt recipeId={id} title={recipe.title} status={imageStatus} />}
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="basil">{categoryLabel(category, t)}</Badge>
            {isOwner && <Badge>{t(`visibility.${recipe.visibility}`)}</Badge>}
            {recipe.verification_status === 'needs_review' && <Badge tone="saffron">{t('card.needsReview')}</Badge>}
          </div>
          <h1 className="display-xl" lang={translationState === 'translation' ? targetLang : origLang}>
            {view.title}
          </h1>
          {!isOwner && owner && (
            <p className="text-muted">
              {t.rich('recipe.ownerBy', { name: owner.display_name || owner.username, link: (c) => <Link href={`/u/${owner.username}`} className="font-semibold text-basil underline underline-offset-4">{c}</Link> })}
            </p>
          )}
          {view.description && <p className="max-w-prose whitespace-pre-line text-lg leading-relaxed">{view.description}</p>}
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {times.map(([key, val, field]) => (
              <div key={key} className="flex items-center gap-2">
                <Clock aria-hidden className="size-4 text-muted" />
                <dt className="text-muted">{t(`recipe.${key}`)}</dt>
                <dd className="font-semibold">
                  {val !== null ? formatMinutes(val, labels) : <span className="font-normal text-muted">{t('recipe.notDetected')}</span>}
                  {flags[field]?.includes('ai_estimate') && <Badge className="ml-2">{t('flags.ai_estimate')}</Badge>}
                </dd>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Users aria-hidden className="size-4 text-muted" />
              <dt className="text-muted">{t('recipe.servings')}</dt>
              <dd className="font-semibold">{recipe.servings !== null ? Number(recipe.servings) : <span className="font-normal text-muted">{t('recipe.notDetected')}</span>}</dd>
            </div>
          </dl>
          {!!recipe.tags?.length && (
            <ul className="flex flex-wrap gap-2">
              {recipe.tags.map((tag) => (
                <li key={tag}>
                  {isOwner ? (
                    <Link href={`/recipes?tag=${encodeURIComponent(tag)}`} className="inline-flex min-h-9 items-center rounded-full bg-sunk px-3 text-sm hover:underline">
                      #{tag}
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-9 items-center rounded-full bg-sunk px-3 text-sm">#{tag}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(recipe.steps?.length ?? 0) > 0 && (
            <LinkButton href={`/recipes/${id}/cook`} variant="primary" size="lg" className="self-start">
              <ChefHat aria-hidden className="size-5" />
              {t('cook.start')}
            </LinkButton>
          )}
          {(recipe.steps?.length ?? 0) > 0 && <CookPrefetch recipeId={id} />}
          <RecipeActions
            recipeId={id}
            isOwner={isOwner}
            ownerId={recipe.owner_id}
            ownerUsername={owner?.username ?? null}
            isFavorite={detail.isFavorite}
            visibility={recipe.visibility}
            servings={recipe.servings === null ? null : Number(recipe.servings)}
            collections={collections.map((c) => ({ id: c.id, name: c.name }))}
            memberOf={detail.collectionIds}
          />
        </div>
      </header>

      <RecipeRating recipeId={id} isOwner={isOwner} avg={recipe.rating_avg} count={recipe.rating_count} mine={myRating?.stars ?? null} />

      {translationState !== 'none' && (
        <TranslateBanner
          recipeId={id}
          fromName={names.of(origLang) ?? origLang}
          toName={names.of(targetLang) ?? targetLang}
          target={targetLang}
          status={translateStatus}
          showing={translationState === 'translation' ? 'translation' : translationState === 'stale' ? 'stale' : 'original'}
        />
      )}

      {recipe.verification_status === 'needs_review' && isOwner && (
        <Alert tone="warn" title={t('recipe.needsReviewTitle')} action={<Link href={`/recipes/${id}/edit`} className="font-semibold text-basil underline underline-offset-4">{t('recipe.reviewNow')}</Link>}>
          {t('recipe.needsReviewBanner')}
        </Alert>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <section aria-labelledby="ing-title" className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <h2 id="ing-title" className="text-2xl font-bold">
            {t('recipe.ingredients')}
          </h2>
          {view.ingredients.length ? (
            <IngredientList recipeId={id} ingredients={view.ingredients} baseServings={recipe.servings === null ? null : Number(recipe.servings)} showFlags={isOwner && recipe.verification_status === 'needs_review'} />
          ) : (
            <p className="text-muted">{t('recipe.noIngredients')}</p>
          )}
        </section>

        <section aria-labelledby="steps-title" className="flex flex-col gap-4">
          <h2 id="steps-title" className="text-2xl font-bold">
            {t('recipe.steps')}
          </h2>
          {view.steps.length ? (
            <ol className="flex flex-col gap-5">
              {view.steps.map((s, i) => (
                <li key={i} className="flex gap-4">
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-saffron font-display text-lg font-bold text-[#2a1a2e]">
                    {i + 1}
                  </span>
                  <div className="flex flex-col gap-1 pt-1">
                    {s.section && (i === 0 || view.steps[i - 1].section !== s.section) && <p className="text-sm font-semibold text-basil">{s.section}</p>}
                    <p className="max-w-prose whitespace-pre-line text-[1.08rem] leading-relaxed">{s.text}</p>
                    {isOwner && s.flags?.length ? (
                      <span className="flex gap-1">
                        {s.flags.map((f) => (
                          <Badge key={f} tone="saffron">
                            {t(`flags.${f}`)}
                          </Badge>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted">{t('recipe.noSteps')}</p>
          )}

          <section aria-labelledby="src-title" className="mt-6 flex flex-col gap-2 border-t border-line pt-6">
            <h2 id="src-title" className="text-xl font-bold">
              {t('recipe.sourceTitle')}
            </h2>
            <p className="text-muted">{t(`recipe.sourceType.${recipe.source_type}`)}</p>
            {recipe.original_author_name && (
              <p>
                {t('recipe.copiedFrom', { name: recipe.original_author_name })}
                {copiedFrom.data && (
                  <>
                    {' '}
                    <Link href={`/recipes/${copiedFrom.data.id}`} className="text-basil underline underline-offset-4">
                      {t('recipe.viewOriginal')}
                    </Link>
                  </>
                )}
              </p>
            )}
            {parent.data && (
              <p>
                {t('recipe.variantOf')}{' '}
                <Link href={`/recipes/${parent.data.id}`} className="font-semibold text-basil underline underline-offset-4">
                  {parent.data.title}
                </Link>
              </p>
            )}
            {(recipe.source_name || recipe.source_attribution) && <p>{[recipe.source_attribution, recipe.source_name].filter(Boolean).join(', ')}</p>}
            {recipe.source_url && (
              <a href={recipe.source_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-basil underline underline-offset-4">
                {recipe.source_url}
                <ExternalLink aria-hidden className="size-4 shrink-0" />
              </a>
            )}
          </section>

          <section className="mt-6 border-t border-line pt-6">
            <NoteEditor recipeId={id} initial={detail.note} />
          </section>
        </section>
      </div>
    </article>
  );
}
