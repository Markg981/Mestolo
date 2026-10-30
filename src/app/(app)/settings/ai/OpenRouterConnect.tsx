'use client';

import { useActionTransition } from '@/lib/run-action';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ExternalLink } from 'lucide-react';
import { deleteApiKey, startOpenRouterConnect } from '@/app/actions/settings';
import { LiveMessage, Modal } from '@/components/client-ui';
import { Button } from '@/components/ui';
import { OPENROUTER_CREDITS_URL, OPENROUTER_KEYS_URL } from '@/lib/ai/openrouter-links';

// Basil and porcelain flip together between themes; saffron with the fixed plum stays readable in both.
const SAFFRON_BTN = 'bg-saffron text-[#3d1a2e] hover:bg-saffron/90';

/** «Collega il tuo account AI»: the green card that connects (or shows) the user's OpenRouter account. */
export function OpenRouterConnect({ connected }: { connected: { key_hint: string; updated_at: string } | null }) {
  const t = useTranslations('aiSettings.openrouter');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useActionTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const connect = () =>
    start(async () => {
      setMsg(null);
      const res = await startOpenRouterConnect();
      if (res.ok) window.location.assign(res.data.url);
      else setMsg({ text: te(res.error), tone: 'error' });
    });

  const disconnect = () =>
    start(async () => {
      const res = await deleteApiKey('openrouter');
      setConfirm(false);
      if (res.ok) {
        setMsg({ text: t('disconnected'), tone: 'success' });
        router.refresh();
      } else setMsg({ text: te(res.error), tone: 'error' });
    });

  return (
    <section className="flex flex-col gap-2">
      <div className="wave-b relative flex flex-col gap-4 overflow-hidden rounded-t-[2rem] bg-basil px-6 pb-16 pt-7 text-porcelain sm:px-8">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full opacity-90"
          style={{ background: 'radial-gradient(circle at 40% 40%, #fff6df 0 18%, #e9b65a 19% 40%, #c9661c 41% 52%, #f3ead8 53% 68%, transparent 69%)' }}
        />
        {connected ? (
          <>
            <div className="flex items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-saffron text-[#3d1a2e]">
                <Check aria-hidden className="size-7" strokeWidth={3} />
              </span>
              <h2 className="max-w-[14ch] font-display text-3xl leading-tight font-bold text-balance sm:text-4xl">{t('connectedTitle')}</h2>
            </div>
            <p className="relative">{t('connectedMeta', { hint: connected.key_hint, date: connected.updated_at })}</p>
            <p className="relative max-w-prose text-[0.95rem] opacity-90">{t('imagesNote')}</p>
            <div className="relative flex flex-wrap gap-2">
              <a href={OPENROUTER_CREDITS_URL} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-bold ${SAFFRON_BTN}`}>
                {t('manage')}
                <ExternalLink aria-hidden className="size-4" />
              </a>
              <button type="button" onClick={() => setConfirm(true)} disabled={pending} className="inline-flex min-h-11 items-center rounded-2xl px-4 font-bold ring-2 ring-inset ring-current">
                {t('disconnect')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="relative text-xs font-bold uppercase tracking-[0.14em] opacity-85">{t('kicker')}</p>
            <h2 className="relative max-w-[12ch] font-display text-4xl leading-[1.05] font-bold text-balance sm:text-5xl">{t('title')}</h2>
            <p className="relative max-w-prose text-[1.05rem]">{t('lead')}</p>
            <ol className="relative flex flex-col gap-3">
              {(['step1', 'step2', 'step3'] as const).map((k, i) => (
                <li key={k} className="grid grid-cols-[2.25rem_1fr] items-start gap-3">
                  <span aria-hidden className="grid size-9 place-items-center rounded-full bg-saffron font-display text-lg font-bold text-[#3d1a2e]">
                    {i + 1}
                  </span>
                  <span className="pt-1.5">{t(k)}</span>
                </li>
              ))}
            </ol>
            <button type="button" onClick={connect} disabled={pending} className={`relative mt-1 inline-flex min-h-12 items-center justify-center gap-2 self-stretch rounded-2xl px-6 text-lg font-bold sm:self-start ${SAFFRON_BTN}`}>
              {pending ? t('connecting') : t('connect')}
            </button>
            <p className="relative text-sm opacity-85">{t('privacy')}</p>
          </>
        )}
      </div>
      <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('disconnectTitle')} closeLabel={tc('close')}>
        <p>
          {t('disconnectConfirm')}{' '}
          <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noopener noreferrer" className="text-terracotta-deep underline underline-offset-4">
            {t('keysPage')}
          </a>
        </p>
        <div className="flex gap-2">
          <Button variant="danger" disabled={pending} onClick={disconnect}>
            {t('disconnect')}
          </Button>
          <Button onClick={() => setConfirm(false)}>{tc('cancel')}</Button>
        </div>
      </Modal>
    </section>
  );
}
