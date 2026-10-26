import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { loadAisleOverrides, loadItems, resolveShoppingList } from '@/lib/shopping/data';
import { PageHeader } from '@/components/ui';
import { ShoppingList, type Item } from './ShoppingList';
import { ShoppingMembers } from './ShoppingMembers';

export async function generateMetadata() {
  const t = await getTranslations('shopping');
  return { title: t('title') };
}

type Profile = { id: string; username: string; display_name: string };
const label = (p: Profile) => p.display_name || p.username;

export default async function ShoppingPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const [t, user, sp] = await Promise.all([getTranslations('shopping'), getUser(), searchParams]);
  const me = user!.id;
  const resolved = await resolveShoppingList(me, sp.list);
  if (!resolved) return <PageHeader title={t('title')} lead={t('lead')} />;
  const { lists, selected } = resolved;
  const isOwner = selected.owner_id === me;
  const supabase = await createClient();

  const [rows, overrides, { data: mem }] = await Promise.all([
    loadItems(selected.id),
    loadAisleOverrides(selected.id),
    supabase.from('shopping_list_members').select('user_id').eq('list_id', selected.id),
  ]);
  const memberIds = ((mem as { user_id: string }[]) ?? []).map((m) => m.user_id);
  let friendIds: string[] = [];
  if (isOwner) {
    const { data: fs } = await supabase.from('friendships').select('requester_id, addressee_id').eq('status', 'accepted');
    friendIds = ((fs as { requester_id: string; addressee_id: string }[]) ?? []).map((f) => (f.requester_id === me ? f.addressee_id : f.requester_id));
  }
  const peopleIds = [...new Set([...memberIds, ...friendIds, selected.owner_id, ...rows.flatMap((r) => [r.owner_id, r.checked_by].filter(Boolean) as string[])])];
  const { data: profs } = peopleIds.length ? await supabase.from('profiles').select('id, username, display_name').in('id', peopleIds) : { data: [] };
  const byId = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
  const nameOf = (id: string | null) => (id && byId.has(id) ? label(byId.get(id)!) : null);

  const shared = memberIds.length > 0 || !isOwner;
  const items: Item[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    quantity: r.quantity === null ? null : Number(r.quantity),
    unit: r.unit,
    note: r.note,
    checked: r.checked,
    recipe_id: r.recipe_id,
    recipe_title: r.recipe_title,
    added_by: r.owner_id === me ? null : nameOf(r.owner_id),
    checked_by: r.checked_by === me ? null : nameOf(r.checked_by),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} lead={t('lead')} />
      <ShoppingMembers
        listId={selected.id}
        listName={selected.name === 'default' ? '' : selected.name}
        isOwner={isOwner}
        ownerName={nameOf(selected.owner_id) ?? '?'}
        me={me}
        lists={lists.map((l) => ({ id: l.id, label: l.owner_id === me ? (l.name === 'default' ? t('defaultName') : l.name) : t('sharedBy', { name: nameOf(l.owner_id) ?? '?' }) }))}
        members={memberIds.map((id) => ({ id, name: nameOf(id) ?? '?' }))}
        friends={friendIds.filter((f) => byId.has(f)).map((f) => ({ id: f, name: label(byId.get(f)!) }))}
      />
      <ShoppingList items={items} listId={selected.id} overrides={overrides} showPeople={shared} />
    </div>
  );
}
