'use client';

import { useActionTransition } from '@/lib/run-action';
import { useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { sendFeedback } from '@/app/actions/feedback';
import { getAppPlatform } from '@/lib/native/platform';
import { Alert, Button, Field, Select, Textarea } from '@/components/ui';

export function FeedbackForm({ appVersion }: { appVersion: string }) {
  const t = useTranslations('feedback');
  const te = useTranslations('errors');
  const [kind, setKind] = useState<'bug' | 'idea' | 'other'>('bug');
  const [message, setMessage] = useState('');
  const platform = useSyncExternalStore(() => () => {}, getAppPlatform, () => 'web' as const);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useActionTransition();

  if (sent)
    return (
      <Alert
        tone="success"
        title={t('sentTitle')}
        action={
          <Button
            size="sm"
            onClick={() => {
              setSent(false);
              setMessage('');
            }}
          >
            {t('sendAnother')}
          </Button>
        }
      >
        {t('sentBody')}
      </Alert>
    );

  const tooShort = message.trim().length < 5;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          let pagePath: string | undefined;
          try {
            pagePath = document.referrer ? new URL(document.referrer).pathname : undefined;
          } catch {
            pagePath = undefined;
          }
          const res = await sendFeedback({ kind, message, platform, appVersion, pagePath });
          if (res.ok) setSent(true);
          else setError(te(res.error));
        });
      }}
    >
      <Field label={t('kind')} htmlFor="fb-kind">
        <Select id="fb-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="bug">{t('kinds.bug')}</option>
          <option value="idea">{t('kinds.idea')}</option>
          <option value="other">{t('kinds.other')}</option>
        </Select>
      </Field>
      <Field label={t('message')} htmlFor="fb-message" hint={t('messageHint')}>
        <Textarea id="fb-message" rows={7} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} required />
      </Field>
      <p className="text-sm text-muted">{t('context', { platform: t(`platforms.${platform}`), version: appVersion || '-' })}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" variant="primary" disabled={pending || tooShort}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
