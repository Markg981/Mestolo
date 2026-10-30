import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { capabilityStatus } from '@/lib/ai/service';
import { env } from '@/lib/env';
import { Alert, Card, PageHeader } from '@/components/ui';
import { ApiKeyForm } from '../SettingsForms';
import { OpenRouterConnect } from './OpenRouterConnect';

export async function generateMetadata() {
  const t = await getTranslations('aiSettings');
  return { title: t('title') };
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

const NONE = { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null } as const;

type KeyRow = { provider: string; key_hint: string; updated_at: string };
const FLASH = { connected: 'success', cancelled: 'info', error: 'error' } as const;

export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<{ openrouter?: string }> }) {
  const sp = await searchParams;
  const flash = sp.openrouter && sp.openrouter in FLASH ? (sp.openrouter as keyof typeof FLASH) : null;
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
  const configured = ((keys as KeyRow[]) ?? []).map((k) => ({ ...k, updated_at: format.dateTime(new Date(k.updated_at), { dateStyle: 'medium' }) }));
  const openrouter = configured.find((k) => k.provider === 'openrouter') ?? null;
  const apiKeys = configured.filter((k) => k.provider !== 'openrouter');

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('title')}
        lead={t('lead')}
        back={
          <Link href="/settings" className="inline-flex min-h-11 items-center self-start text-terracotta-deep underline underline-offset-4">
            {t('back')}
          </Link>
        }
      />
      {flash && <Alert tone={FLASH[flash]}>{t(`openrouter.flash.${flash}`)}</Alert>}
      {encryptionReady && <OpenRouterConnect connected={openrouter && { key_hint: openrouter.key_hint, updated_at: openrouter.updated_at }} />}
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

      {!encryptionReady ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">{t('keysTitle')}</h2>
          <Alert tone="warn">{t('encryptionMissing')}</Alert>
        </Card>
      ) : (
        // Opzione avanzata: chiusa finche' l'utente non ha gia' una chiave Anthropic/OpenAI
        <details open={apiKeys.length > 0} className="group rounded-[1.75rem] border-2 border-dashed border-line bg-surface">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6">
            <span className="flex flex-col">
              <span className="font-bold">{t('openrouter.advancedTitle')}</span>
              <span className="text-sm text-muted">{t('openrouter.advancedLead')}</span>
            </span>
            <span aria-hidden className="text-2xl text-muted transition-transform group-open:rotate-90">›</span>
          </summary>
          <div className="flex flex-col gap-4 px-5 pb-5 sm:px-6">
            <p className="text-muted">{t('keysLead')}</p>
            <ApiKeyForm configured={apiKeys} />
          </div>
        </details>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t('costTitle')}</h2>
        <p>{t('costText')}</p>
        <h2 className="mt-4 text-xl font-bold">{t('privacyTitle')}</h2>
        <p>{t('privacyText')}</p>
      </Card>
    </div>
  );
}
