import { redirect } from 'next/navigation';
import { UserCacheSync } from '@/components/pwa/PwaClient';
import { MealReminderSync } from '@/components/pwa/MealReminderSync';
import { AppShell } from '@/components/shell/AppShell';
import { getProfile, requireUser } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const profile = await getProfile();
  if (!profile) redirect('/login');
  return (
    <AppShell username={profile.username} isModerator={profile.is_moderator}>
      <UserCacheSync userId={user.id} />
      <MealReminderSync />
      {children}
    </AppShell>
  );
}
