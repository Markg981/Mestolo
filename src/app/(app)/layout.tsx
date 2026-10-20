import { redirect } from 'next/navigation';
import { UserCacheSync } from '@/components/pwa/PwaClient';
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
    <AppShell username={profile.username} isModerator={profile.is_moderator}>
      <UserCacheSync userId={user.id} />
      <RealtimeSync userId={user.id} supabaseUrl={supabaseUrl} supabaseAnonKey={supabaseAnonKey} />
      {children}
    </AppShell>
  );
}
