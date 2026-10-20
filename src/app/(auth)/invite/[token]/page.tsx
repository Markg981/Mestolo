import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { isPlausibleInviteToken } from '@/lib/invites';
import { Alert, LinkButton } from '@/components/ui';
import { AcceptInviteButton } from './AcceptInviteButton';

// Il token e' nel percorso: niente referrer e niente indicizzazione
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('invites');

  let inviter: { username: string; display_name: string } | null = null;
  if (isPlausibleInviteToken(token)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc('invite_preview', { p_token: token });
    inviter = (data as { username: string; display_name: string }[] | null)?.[0] ?? null;
  }

  if (!inviter) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8 sm:py-14">
        <h1 className="display-lg">{t('invalidTitle')}</h1>
        <Alert tone="error">{t('invalid')}</Alert>
        <LinkButton href="/" variant="primary">
          {t('home')}
        </LinkButton>
      </div>
    );
  }

  const user = await getUser();
  const name = inviter.display_name || inviter.username;
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8 sm:py-14">
      <div className="flex flex-col gap-2">
        <h1 className="display-lg">{t('landingTitle', { name })}</h1>
        <p className="text-muted">@{inviter.username}</p>
        <p className="text-muted">{t('landingLead')}</p>
      </div>
      {user ? (
        <AcceptInviteButton token={token} />
      ) : (
        <div className="flex flex-col gap-3">
          <LinkButton href={`/signup?next=${next}`} variant="primary" size="lg">
            {t('signup')}
          </LinkButton>
          <LinkButton href={`/login?next=${next}`} size="lg">
            {t('login')}
          </LinkButton>
        </div>
      )}
    </div>
  );
}
