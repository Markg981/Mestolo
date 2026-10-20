'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { createInvite, revokeInvite } from '@/app/actions/invites';
import { LiveMessage } from '@/components/client-ui';
import { Button } from '@/components/ui';

export type InviteRow = { id: string; uses: number; max_uses: number; expires_at: string };

export function InviteSection({ invites }: { invites: InviteRow[] }) {
  const t = useTranslations('invites');
  const te = useTranslations('errors');
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMsg({ text: t('copied'), tone: 'success' });
    } catch {
      setMsg({ text: t('copyFailed'), tone: 'error' });
    }
  };
  const share = async (value: string) => {
    try {
      await navigator.share({ title: t('shareTitle'), text: t('shareText'), url: value });
    } catch {
      // annullato dall'utente
    }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-xl font-bold">{t('title')}</h2>
      <p className="text-muted">{t('lead')}</p>
      <div>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await createInvite();
              if (res.ok && res.data) {
                setUrl(res.data.url);
                setMsg(null);
                router.refresh();
              } else if (!res.ok) setMsg({ text: te(res.error), tone: 'error' });
            })
          }
        >
          {t('create')}
        </Button>
      </div>
      {url && (
        <div className="flex flex-col gap-2 rounded-2xl border border-line p-3">
          <p className="text-sm text-muted">{t('linkOnce')}</p>
          <input readOnly value={url} aria-label={t('linkLabel')} className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => copy(url)}>
              {t('copy')}
            </Button>
            {canShare && (
              <Button size="sm" onClick={() => share(url)}>
                {t('share')}
              </Button>
            )}
          </div>
        </div>
      )}
      {invites.length > 0 && (
        <ul className="flex flex-col gap-2">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{t('uses', { used: i.uses, max: i.max_uses })}</p>
                <p className="text-muted">{t('expires', { date: format.dateTime(new Date(i.expires_at), { dateStyle: 'medium' }) })}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await revokeInvite(i.id);
                    if (res.ok) router.refresh();
                    else setMsg({ text: te(res.error), tone: 'error' });
                  })
                }
              >
                {t('revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
    </section>
  );
}
