import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { getProfile, requireUser } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const profile = await getProfile();
  if (!profile) redirect('/login');
  return (
    <AppShell username={profile.username} isModerator={profile.is_moderator}>
      {children}
    </AppShell>
  );
}
