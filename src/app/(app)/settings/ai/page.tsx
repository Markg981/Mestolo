import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { capabilityStatus } from '@/lib/ai/service';
import { env } from '@/lib/env';
import { Alert, Card, PageHeader } from '@/components/ui';
import { ApiKeyForm } from '../SettingsForms';

export async function generateMetadata() {
  const t = await getTranslations('aiSettings');
  return { title: t('title') };
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

const NONE = { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null } as const;

export default async function AiSettingsPage() {
  const [t, format, user] = await Promise.all([getTranslations('aiSettings'), getFormatter(), getUser()]);
  const supabase = await createClient();
  const { data: keys } = await supabase.rpc('my_api_keys');
  const caps = [
    ['text', 'text', 'text'],
    ['vision', 'vision', 'vision'],
    ['translate', 'text', 'translate'],
    ['image', 'image', 'image'],
  ] as const;
  const statuses = await Promise.all(caps.map(([, cap, group]) => capabilityStatus(user!.id, cap, group).catch(() => NONE)));
  const since = daysAgoIso(30);
  const { count: usedUser } = await supabase.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', user!.id).eq('key_source', 'user').gte('created_at', since);
  const { count: usedApp } = await supabase.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', user!.id).eq('key_source', 'app').gte('created_at', since);
  const encryptionReady = !!env().encryptionKey;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('title')}
        lead={t('lead')}
        back={
          <Link href="/settings" className="inline-flex min-h-11 items-center self-start text-basil underline underline-offset-4">
            {t('back')}
          </Link>
        }
      />
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{t('statusTitle')}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {caps.map(([key], i) => {
            const s = statuses[i];
            return (
              <li key={key} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-semibold">{t(`capability.${key}`)}</span>
                <span className="text-muted">
                  {s.keySource === 'user'
                    ? t('statusUser', { provider: s.providerName ?? '' })
                    : s.keySource === 'app'
                      ? t('statusApp', { provider: s.providerName ?? '', remaining: s.remainingToday ?? 0, limit: s.dailyLimit ?? 0 })
                      : t('statusNone')}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted">{t('freeFeatures')}</p>
        <p className="text-sm text-muted">{t('usage30', { user: usedUser ?? 0, app: usedApp ?? 0 })}</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">{t('keysTitle')}</h2>
        <p className="text-muted">{t('keysLead')}</p>
        {!encryptionReady ? (
          <Alert tone="warn">{t('encryptionMissing')}</Alert>
        ) : (
          <ApiKeyForm configured={((keys as { provider: string; key_hint: string; updated_at: string }[]) ?? []).map((k) => ({ ...k, updated_at: format.dateTime(new Date(k.updated_at), { dateStyle: 'medium' }) }))} />
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t('costTitle')}</h2>
        <p>{t('costText')}</p>
        <h2 className="mt-4 text-xl font-bold">{t('privacyTitle')}</h2>
        <p>{t('privacyText')}</p>
      </Card>
    </div>
  );
}
