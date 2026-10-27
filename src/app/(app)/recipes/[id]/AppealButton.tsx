'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { appealModeration } from '@/app/actions/moderation-appeal';
import { Button } from '@/components/ui';

export function AppealButton({ recipeId }: { recipeId: string }) {
  const t = useTranslations('recipe');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await appealModeration(recipeId);
            if (res.ok) router.refresh();
            else setError(te(res.error));
          })
        }
      >
        {t('appeal')}
      </Button>
      {error && <p className="text-sm font-semibold text-tomato" role="alert">{error}</p>}
    </div>
  );
}
