'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { acceptInvite } from '@/app/actions/invites';
import { LiveMessage } from '@/components/client-ui';
import { Button } from '@/components/ui';

export function AcceptInviteButton({ token }: { token: string }) {
  const t = useTranslations('invites');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="primary"
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await acceptInvite(token);
            if (res.ok) router.push('/friends');
            else setMsg(res.error === 'not_found' ? t('invalid') : te(res.error));
          })
        }
      >
        {t('accept')}
      </Button>
      <LiveMessage message={msg} tone="error" />
    </div>
  );
}
