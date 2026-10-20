'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import { copyRecipe } from '@/app/actions/recipes';
import { LiveMessage } from '../client-ui';
import { Button } from '../ui';

/** Signed-in visitors: saves a private copy (with author attribution) in their own recipe book. */
export function SavePublicRecipe({ recipeId }: { recipeId: string }) {
  const t = useTranslations('publicPage');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await copyRecipe(recipeId, 'copy');
            if (res.ok) router.push(`/recipes/${res.data.id}?copied=1`);
            else setError(te(res.error));
          })
        }
      >
        <Copy aria-hidden className="size-5" />
        {t('save')}
      </Button>
      <LiveMessage message={error} tone="error" />
    </div>
  );
}
