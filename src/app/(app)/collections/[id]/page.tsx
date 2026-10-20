import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { attachCovers, listCategories, LIST_COLUMNS, type RecipeListItem } from '@/lib/data/recipes';
import { RecipeCard, RecipeGrid } from '@/components/recipes/RecipeCard';
import { EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { CollectionAdmin } from '../CollectionForms';

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  const supabase = await createClient();
  const { data: col } = await supabase.from('collections').select('id, name, description').eq('id', id).eq('owner_id', user!.id).maybeSingle();
  if (!col) notFound();
  const [t, categories] = await Promise.all([getTranslations('collections'), listCategories()]);
  const { data: links } = await supabase.from('collection_recipes').select('recipe_id, added_at').eq('collection_id', id).order('added_at', { ascending: false });
  const ids = ((links as { recipe_id: string }[]) ?? []).map((l) => l.recipe_id);
  const { data: rows } = ids.length ? await supabase.from('recipes').select(LIST_COLUMNS).in('id', ids) : { data: [] };
  const recipes = await attachCovers((rows as RecipeListItem[]) ?? []);
  const ordered = ids.map((rid) => recipes.find((r) => r.id === rid)).filter(Boolean) as RecipeListItem[];
  return (
    <div>
      <PageHeader
        title={col.name}
        lead={col.description || undefined}
        back={
          <Link href="/collections" className="text-basil underline underline-offset-4">
            {t('title')}
          </Link>
        }
        actions={<CollectionAdmin id={col.id} name={col.name} description={col.description} />}
      />
      {ordered.length ? (
        <RecipeGrid>
          {ordered.map((r) => (
            <RecipeCard key={r.id} recipe={r} categories={categories} showAuthor={r.owner_id !== user!.id} />
          ))}
        </RecipeGrid>
      ) : (
        <EmptyState title={t('emptyCollectionTitle')} action={<LinkButton href="/recipes">{t('browseRecipes')}</LinkButton>}>
          {t('emptyCollection')}
        </EmptyState>
      )}
    </div>
  );
}
