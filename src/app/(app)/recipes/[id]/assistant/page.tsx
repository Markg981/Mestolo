import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getUser } from '@/lib/supabase/server';
import { getRecipeDetail } from '@/lib/data/recipes';
import { capabilityStatus } from '@/lib/ai/service';
import { PageHeader } from '@/components/ui';
import { Assistant } from './Assistant';

// Server action AI nella pagina: timeout provider fino a 120 s, quindi 150 s (piano Vercel da verificare).
export const maxDuration = 150;

const NONE = { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null } as const;

export default async function AssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getRecipeDetail(id);
  if (!detail) notFound();
  const user = await getUser();
  const t = await getTranslations('assistant');
  const status = user ? await capabilityStatus(user.id, 'text', 'text').catch(() => NONE) : NONE;
  const r = detail.recipe;
  return (
    <div>
      <PageHeader
        title={t('title')}
        lead={t('lead')}
        back={
          <Link href={`/recipes/${id}`} className="inline-flex min-h-11 items-center self-start text-terracotta-deep underline underline-offset-4">
            {r.title}
          </Link>
        }
      />
      <Assistant
        recipeId={id}
        isOwner={detail.isOwner}
        status={{ ...status }}
        ingredients={(r.ingredients ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit }))}
        steps={(r.steps ?? []).map((s) => s.text)}
        times={{ prep_minutes: r.prep_minutes, cook_minutes: r.cook_minutes, total_minutes: r.total_minutes }}
      />
    </div>
  );
}
