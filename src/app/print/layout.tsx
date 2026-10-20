import { requireUser } from '@/lib/supabase/server';

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <main className="mx-auto max-w-3xl bg-white p-6 text-black sm:p-10">{children}</main>;
}
