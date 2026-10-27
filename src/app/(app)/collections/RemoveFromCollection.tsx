'use client';

import { useActionTransition } from '@/lib/run-action';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setRecipeInCollection } from '@/app/actions/organize';
import { Button } from '@/components/ui';

export function RemoveFromCollection({ collectionId, recipeId }: { collectionId: string; recipeId: string }) {
  const t = useTranslations('collectionSharing');
  const router = useRouter();
  const [pending, start] = useActionTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-tomato"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setRecipeInCollection(collectionId, recipeId, false);
          if (res.ok) router.refresh();
        })
      }
    >
      {t('removeRecipe')}
    </Button>
  );
}
