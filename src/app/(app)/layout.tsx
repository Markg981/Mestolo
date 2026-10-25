import { redirect } from 'next/navigation';
import { UserCacheSync } from '@/components/pwa/PwaClient';
import { MealReminderSync } from '@/components/pwa/MealReminderSync';
import { DraftUserProvider } from '@/components/recipes/editor/DraftUser';
import { RealtimeSync } from '@/components/RealtimeSync';
import { AppShell } from '@/components/shell/AppShell';
import { env } from '@/lib/env';
import { getProfile, requireUser } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const profile = await getProfile();
  if (!profile) redirect('/login');
  const { supabaseUrl, supabaseAnonKey } = env();
  return (
    <AppShell username={profile.username} isModerator={profile.is_moderator} userId={user.id} hasAvatar={!!profile.avatar_path}>
      <UserCacheSync userId={user.id} />
      <MealReminderSync />
      <RealtimeSync userId={user.id} supabaseUrl={supabaseUrl} supabaseAnonKey={supabaseAnonKey} />
      <DraftUserProvider userId={user.id}>{children}</DraftUserProvider>
    </AppShell>
  );
}
