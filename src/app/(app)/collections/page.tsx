import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listCollections } from '@/lib/data/recipes';
import { EmptyState, PageHeader } from '@/components/ui';
import { NewCollectionForm } from './CollectionForms';

export async function generateMetadata() {
  const t = await getTranslations('collections');
  return { title: t('title') };
}

export default async function CollectionsPage() {
  const [t, collections] = await Promise.all([getTranslations('collections'), listCollections()]);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('title')} lead={t('lead')} />
      <NewCollectionForm suggestions={[t('suggestionFamily'), t('suggestionTry'), t('suggestionQuick')]} showSuggestions={!collections.length} />
      {collections.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => (
            <li key={c.id}>
              <Link href={`/collections/${c.id}`} className="card-tab flex h-full flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-5 hover:bg-sunk">
                <span className="font-display text-xl font-bold">{c.name}</span>
                {c.description && <span className="line-clamp-2 text-sm text-muted">{c.description}</span>}
                <span className="mt-auto pt-2 text-sm text-muted">{t('count', { n: c.count })}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t('emptyTitle')}>{t('empty')}</EmptyState>
      )}
    </div>
  );
}
