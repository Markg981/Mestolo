import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Clock, Users } from 'lucide-react';
import { getUser } from '@/lib/supabase/server';
import { getPublicRecipe } from '@/lib/data/public-recipes';
import { env } from '@/lib/env';
import { LOCALES } from '@/i18n/config';
import { buildRecipeJsonLd, metaDescription, publicImageUrl, publicRecipePath, publicRecipeUrl, serializeJsonLd } from '@/lib/recipes/public-page';
import { ingredientToText } from '@/lib/recipes/export';
import { formatMinutes } from '@/lib/recipes/duration';
import { categoryLabel } from '@/lib/recipes/categories';
import { Logo } from '@/components/shell/AppShell';
import { RecipeImage } from '@/components/recipes/RecipeImage';
import { SavePublicRecipe } from '@/components/recipes/SavePublicRecipe';
import { Badge, LinkButton } from '@/components/ui';

type Params = { params: Promise<{ slug: string }> };

/** Server-rendered public recipe page. Anything that is not an active public page is a plain 404 (noindex). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const r = await getPublicRecipe(slug).catch(() => null);
  if (!r) return { title: 'Mestolo', robots: { index: false, follow: false } };
  const { siteUrl } = env();
  const url = publicRecipeUrl(siteUrl, r.slug);
  const lang = r.original_language.slice(0, 2);
  const description = metaDescription(r);
  const image = r.cover_image_id ? [{ url: publicImageUrl(siteUrl, r.cover_image_id), alt: r.cover_alt || r.title }] : undefined;
  return {
    title: r.title,
    description,
    alternates: {
      canonical: url,
      languages: { [r.original_language]: url, ...(LOCALES.includes(lang as (typeof LOCALES)[number]) ? { [lang]: url } : {}), 'x-default': url },
    },
    robots: { index: true, follow: true, 'max-image-preview': 'large' },
    openGraph: { type: 'article', url, title: r.title, description, siteName: 'Mestolo', locale: r.original_language, images: image },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: r.title, description, images: image?.map((i) => i.url) },
  };
}

export default async function PublicRecipePage({ params }: Params) {
  const { slug } = await params;
  const r = await getPublicRecipe(slug).catch(() => null);
  if (!r) notFound();
  const [t, user] = await Promise.all([getTranslations(), getUser()]);
  const lang = r.original_language;
  const labels = { h: t('common.hoursShort'), min: t('common.minShort') };
  const times = [
    ['prep', r.prep_minutes],
    ['cook', r.cook_minutes],
    ['total', r.total_minutes],
  ] as const;
  const jsonLd = buildRecipeJsonLd(r, { siteUrl: env().siteUrl, categoryName: r.category_slug ? categoryLabel({ slug: r.category_slug, name: null, owner_id: null }, t) : null });
  const path = publicRecipePath(r.slug);

  const groups: { section: string | null; items: string[] }[] = [];
  for (const i of r.ingredients) {
    const section = i.section?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.items.push(ingredientToText(i));
    else groups.push({ section, items: [ingredientToText(i)] });
  }

  const cta = user ? (
    <SavePublicRecipe recipeId={r.id} />
  ) : (
    <div className="flex flex-col items-start gap-2">
      <LinkButton href="/signup" variant="primary" size="lg">
        {t('publicPage.save')}
      </LinkButton>
      <p className="text-sm text-muted">
        {t('publicPage.haveAccount')}{' '}
        <Link href={`/login?next=${encodeURIComponent(path)}`} className="font-semibold text-basil underline underline-offset-4" rel="nofollow">
          {t('publicPage.login')}
        </Link>
      </p>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-4 py-6 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <header className="flex items-center justify-between">
        <Link href={user ? '/' : '/welcome'} aria-label="Mestolo">
          <Logo />
        </Link>
      </header>
      <main id="main" className="flex flex-col gap-8">
        <article lang={lang} className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-card)] bg-sunk">
              {r.cover_image_id ? (
                <img src={`/api/public-images/${r.cover_image_id}`} alt={r.cover_alt || r.title} fetchPriority="high" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <RecipeImage imageId={null} title={r.title} size="full" className="h-full w-full" />
              )}
            </div>
            {r.cover_kind === 'ai_generated' && <Badge tone="ink">{t('image.aiLabel')}</Badge>}
          </div>

          <div className="flex flex-col gap-4">
            {r.category_slug && (
              <div className="flex flex-wrap gap-2">
                <Badge tone="basil">{categoryLabel({ slug: r.category_slug, name: null, owner_id: null }, t)}</Badge>
              </div>
            )}
            <h1 className="display-xl">{r.title}</h1>
            {r.author_name && <p className="text-muted">{t('publicPage.byAuthor', { name: r.author_name })}</p>}
            {r.description && <p className="max-w-prose whitespace-pre-line text-lg leading-relaxed">{r.description}</p>}
            <dl className="flex flex-wrap gap-x-6 gap-y-2">
              {times.map(([key, val]) =>
                val !== null ? (
                  <div key={key} className="flex items-center gap-2">
                    <Clock aria-hidden className="size-4 text-muted" />
                    <dt className="text-muted">{t(`recipe.${key}`)}</dt>
                    <dd className="font-semibold">{formatMinutes(val, labels)}</dd>
                  </div>
                ) : null,
              )}
              {r.servings !== null && (
                <div className="flex items-center gap-2">
                  <Users aria-hidden className="size-4 text-muted" />
                  <dt className="text-muted">{t('recipe.servings')}</dt>
                  <dd className="font-semibold">{Number(r.servings)}</dd>
                </div>
              )}
            </dl>
            {cta}
          </div>

          {groups.length > 0 && (
            <section aria-labelledby="ing" className="flex flex-col gap-3">
              <h2 id="ing" className="display-md">
                {t('recipe.ingredients')}
              </h2>
              {groups.map((g, gi) => (
                <div key={gi} className="flex flex-col gap-2">
                  {g.section && <h3 className="font-semibold">{g.section}</h3>}
                  <ul className="flex list-disc flex-col gap-1.5 pl-6">
                    {g.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {r.steps.length > 0 && (
            <section aria-labelledby="steps" className="flex flex-col gap-3">
              <h2 id="steps" className="display-md">
                {t('recipe.steps')}
              </h2>
              <ol className="flex list-decimal flex-col gap-3 pl-6 leading-relaxed">
                {r.steps.map((s, i) => (
                  <li key={i}>{s.text}</li>
                ))}
              </ol>
            </section>
          )}

          {!!r.tags.length && (
            <ul className="flex flex-wrap gap-2">
              {r.tags.map((tag) => (
                <li key={tag} className="inline-flex min-h-9 items-center rounded-full bg-sunk px-3 text-sm">
                  #{tag}
                </li>
              ))}
            </ul>
          )}

          {r.source_name && <p className="text-sm text-muted">{t('publicPage.source', { name: r.source_name })}</p>}
        </article>

        <aside className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-sunk p-6">
          <h2 className="display-md">{t('publicPage.ctaTitle')}</h2>
          <p className="max-w-prose text-muted">{t('publicPage.ctaLead')}</p>
          {cta}
        </aside>
      </main>
    </div>
  );
}
