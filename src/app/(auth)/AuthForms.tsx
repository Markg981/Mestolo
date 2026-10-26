'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { requestPasswordReset, signIn, signUp, updatePassword, type AuthState } from '@/app/actions/auth';
import { SubmitButton } from '@/components/client-ui';
import { Alert, Field, Input } from '@/components/ui';

function ErrorAlert({ state }: { state: AuthState }) {
  const te = useTranslations('errors');
  if (!state?.error) return null;
  return <Alert tone="error">{te(state.error)}</Alert>;
}

export function LoginForm({ next, linkError }: { next?: string; linkError?: boolean }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState(signIn, undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate={false}>
      {linkError && <Alert tone="error">{t('linkError')}</Alert>}
      <ErrorAlert state={state} />
      <input type="hidden" name="next" value={next ?? '/'} />
      <Field label={t('email')} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      </Field>
      <Field label={t('password')} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
      </Field>
      <SubmitButton pendingLabel={t('pendingLogin')}>{t('submitLogin')}</SubmitButton>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-basil underline underline-offset-4">
          {t('forgot')}
        </Link>
        <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'} className="inline-flex min-h-11 items-center text-basil underline underline-offset-4">
          {t('noAccount')}
        </Link>
      </div>
    </form>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [state, action] = useActionState(signUp, undefined);
  if (state?.sent) {
    return (
      <Alert tone="success" title={t('checkEmailTitle')}>
        {t('checkEmail', { email: state.email ?? '' })}
      </Alert>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <ErrorAlert state={state} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next ?? '/'} />
      <Field label={t('username')} htmlFor="username" hint={t('usernameHint')}>
        <Input id="username" name="username" autoComplete="username" required pattern="[a-z0-9_]{3,24}" minLength={3} maxLength={24} autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label={t('email')} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      </Field>
      <Field label={t('password')} htmlFor="password" hint={t('passwordHint')}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <label className="flex items-start gap-3 text-[0.97rem]">
        <input type="checkbox" name="terms" required className="mt-1 size-5 accent-[var(--basil)]" />
        <span>
          {t.rich('termsLabel', {
            terms: (chunks) => (
              <Link href="/terms" className="text-basil underline underline-offset-4">
                {chunks}
              </Link>
            ),
            link: (chunks) => (
              <Link href="/privacy" className="text-basil underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </span>
      </label>
      <SubmitButton pendingLabel={t('pendingSignup')}>{t('submitSignup')}</SubmitButton>
      <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="inline-flex min-h-11 items-center self-start text-sm text-basil underline underline-offset-4">
        {t('haveAccount')}
      </Link>
    </form>
  );
}

export function ForgotForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState(requestPasswordReset, undefined);
  if (state?.sent) return <Alert tone="success">{t('resetSent', { email: state.email ?? '' })}</Alert>;
  return (
    <form action={action} className="flex flex-col gap-4">
      <ErrorAlert state={state} />
      <Field label={t('email')} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <SubmitButton pendingLabel={t('sending')}>{t('sendReset')}</SubmitButton>
    </form>
  );
}

export function ResetForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <ErrorAlert state={state} />
      <Field label={t('newPassword')} htmlFor="password" hint={t('passwordHint')}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label={t('confirmPassword')} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <SubmitButton pendingLabel={t('saving')}>{t('updatePassword')}</SubmitButton>
    </form>
  );
}
