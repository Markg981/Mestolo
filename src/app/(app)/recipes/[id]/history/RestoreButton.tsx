'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { restoreVersion } from '@/app/actions/recipes';
import { Modal } from '@/components/client-ui';
import { Button } from '@/components/ui';

export function RestoreButton({ recipeId, version }: { recipeId: string; version: number }) {
  const t = useTranslations('history');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('restore')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('restoreTitle', { n: version })} closeLabel={tc('close')}>
        <p>{t('restoreConfirm')}</p>
        {error && <p className="font-semibold text-tomato" role="alert">{error}</p>}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await restoreVersion(recipeId, version);
                if (res.ok) {
                  setOpen(false);
                  router.refresh();
                } else setError(te(res.error));
              })
            }
          >
            {t('restore')}
          </Button>
          <Button onClick={() => setOpen(false)}>{tc('cancel')}</Button>
        </div>
      </Modal>
    </>
  );
}
