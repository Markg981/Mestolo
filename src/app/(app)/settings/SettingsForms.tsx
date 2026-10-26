'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { uploadAvatar, removeAvatar } from '@/app/actions/profile';
import { Avatar } from '@/components/Avatar';
import { updateProfile, deleteApiKey, saveApiKey, deleteAccount } from '@/app/actions/settings';
import { changePassword } from '@/app/actions/auth';
import { createCategory, deleteCategory } from '@/app/actions/organize';
import { LiveMessage, Modal } from '@/components/client-ui';
import { Alert, Button, Card, Field, Input, Select, Textarea, buttonClass } from '@/components/ui';
import type { Profile } from '@/lib/supabase/server';
import { MAX_UPLOAD_BYTES } from '@/lib/images/limits';
import { DIETS } from '@/lib/recipes/diets';

function AvatarEditor({ userId, name, hasImage }: { userId: string; name: string; hasImage: boolean }) {
  const tr = useTranslations('richProfile');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const run = (fn: () => ReturnType<typeof uploadAvatar>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ text: tr('avatarSaved'), tone: 'success' });
        router.refresh();
      } else setMsg({ text: te(res.error), tone: 'error' });
    });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar key={String(hasImage)} userId={userId} name={name} hasImage={hasImage} size="lg" />
      <div className="flex flex-col gap-2">
        <label className={buttonClass('secondary', 'md', 'cursor-pointer')}>
          {tr('avatarChange')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > MAX_UPLOAD_BYTES) {
                setMsg({ text: te('image_too_large'), tone: 'error' });
                return;
              }
              const fd = new FormData();
              fd.set('file', file);
              run(() => uploadAvatar(fd));
            }}
          />
        </label>
        {hasImage && (
          <Button size="sm" type="button" disabled={pending} onClick={() => run(() => removeAvatar())}>
            {tr('avatarRemove')}
          </Button>
        )}
        <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
      </div>
    </div>
  );
}

export function ProfileForm({ profile, systemCategories }: { profile: Profile; systemCategories: { slug: string; label: string }[] }) {
  const t = useTranslations('settings');
  const tr = useTranslations('richProfile');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [p, setP] = useState({
    username: profile.username,
    display_name: profile.display_name,
    bio: profile.bio,
    location: profile.location,
    website: profile.website ?? '',
    favorite_cuisines: profile.favorite_cuisines.join(', '),
    profile_visibility: profile.profile_visibility,
    discoverable: profile.discoverable,
    dietary_preferences: profile.dietary_preferences,
    avoided_ingredients: profile.avoided_ingredients.join(', '),
    hidden_categories: profile.hidden_categories,
  });
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pending, start] = useTransition();
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await updateProfile({
        ...p,
        favorite_cuisines: p.favorite_cuisines.split(','),
        avoided_ingredients: p.avoided_ingredients.split(',').map((x) => x.trim()).filter(Boolean),
      });
      if (res.ok) {
        setMsg({ text: t('saved'), tone: 'success' });
        router.refresh();
      } else setMsg({ text: te(res.error), tone: 'error' });
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">{t('profileTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('username')} htmlFor="un" hint={t('usernameHint')}>
            <Input id="un" value={p.username} pattern="[a-z0-9_]{3,24}" onChange={(e) => setP({ ...p, username: e.target.value.toLowerCase() })} autoCapitalize="none" />
          </Field>
          <Field label={t('displayName')} htmlFor="dn">
            <Input id="dn" value={p.display_name} maxLength={60} onChange={(e) => setP({ ...p, display_name: e.target.value })} />
          </Field>
        </div>
        <Field label={t('bio')} htmlFor="bio">
          <Textarea id="bio" value={p.bio} maxLength={280} onChange={(e) => setP({ ...p, bio: e.target.value })} rows={2} />
        </Field>
        <AvatarEditor userId={profile.id} name={profile.display_name || profile.username} hasImage={!!profile.avatar_path} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr('location')} htmlFor="loc">
            <Input id="loc" value={p.location} maxLength={80} onChange={(e) => setP({ ...p, location: e.target.value })} />
          </Field>
          <Field label={tr('website')} htmlFor="web" hint={tr('websiteHint')}>
            <Input id="web" type="url" inputMode="url" value={p.website} maxLength={200} placeholder="https://" onChange={(e) => setP({ ...p, website: e.target.value })} />
          </Field>
        </div>
        <Field label={tr('cuisines')} htmlFor="cui" hint={tr('cuisinesHint')}>
          <Input id="cui" value={p.favorite_cuisines} onChange={(e) => setP({ ...p, favorite_cuisines: e.target.value })} />
        </Field>
        <Field label={tr('visibility')} htmlFor="vis" hint={tr('visibilityHint')}>
          <Select id="vis" value={p.profile_visibility} onChange={(e) => setP({ ...p, profile_visibility: e.target.value as typeof p.profile_visibility })}>
            {(['public', 'friends', 'private'] as const).map((v) => (
              <option key={v} value={v}>
                {tr(`visibilityOptions.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={p.discoverable} onChange={(e) => setP({ ...p, discoverable: e.target.checked })} className="mt-1 size-5 accent-[var(--basil)]" />
          <span>
            <span className="font-semibold">{t('discoverable')}</span>
            <span className="block text-sm text-muted">{t('discoverableHint')}</span>
          </span>
        </label>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">{t('foodTitle')}</h2>
        <p className="text-muted">{t('foodLead')}</p>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-semibold">{t('dietsLabel')}</legend>
          <div className="flex flex-wrap gap-x-5">
            {DIETS.map((d) => (
              <label key={d} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={p.dietary_preferences.includes(d)} onChange={() => setP({ ...p, dietary_preferences: toggle(p.dietary_preferences, d) })} className="size-5 accent-[var(--basil)]" />
                {t(`diets.${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t('avoided')} htmlFor="avoid" hint={t('avoidedHint')}>
          <Input id="avoid" value={p.avoided_ingredients} onChange={(e) => setP({ ...p, avoided_ingredients: e.target.value })} />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-semibold">{t('hiddenCategories')}</legend>
          <div className="flex flex-wrap gap-x-5">
            {systemCategories.map((c) => (
              <label key={c.slug} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={p.hidden_categories.includes(c.slug)} onChange={() => setP({ ...p, hidden_categories: toggle(p.hidden_categories, c.slug) })} className="size-5 accent-[var(--basil)]" />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Alert tone="info">{t('foodDisclaimer')}</Alert>
      </Card>

      <div className="flex items-center gap-3">
        <button type="submit" className={buttonClass('primary', 'lg')} disabled={pending}>
          {pending ? tc('saving') : tc('save')}
        </button>
        <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
      </div>
    </form>
  );
}

export function CustomCategories({ categories }: { categories: { id: string; name: string }[] }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{t('categoriesTitle')}</h2>
      <p className="text-muted">{t('categoriesLead')}</p>
      {categories.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-full border border-line bg-surface pl-4">
              {c.name}
              <Button size="sm" variant="ghost" className="size-10 px-0" aria-label={t('deleteCategory', { name: c.name })} disabled={pending} onClick={() => start(async () => { const r = await deleteCategory(c.id); if (r.ok) router.refresh(); else setError(te(r.error)); })}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createCategory(name);
            if (r.ok) {
              setName('');
              router.refresh();
            } else setError(te(r.error));
          });
        }}
      >
        <label htmlFor="cat" className="sr-only">
          {t('addCategory')}
        </label>
        <Input id="cat" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t('addCategoryPlaceholder')} />
        <button type="submit" className={buttonClass('secondary')} disabled={pending || !name.trim()}>
          {tc('add')}
        </button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
    </Card>
  );
}

export function ApiKeyForm({ configured }: { configured: { provider: string; key_hint: string; updated_at: string }[] }) {
  const t = useTranslations('aiSettings');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('openai');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      {configured.length > 0 && (
        <ul className="flex flex-col gap-2">
          {configured.map((k) => (
            <li key={k.provider} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              <span className="font-semibold">{k.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
              <span className="tabular text-muted">{t('configured', { hint: k.key_hint })}</span>
              <Button size="sm" variant="ghost" className="ml-auto text-tomato" onClick={() => setConfirm(k.provider)}>
                {t('removeKey')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-3"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await saveApiKey({ provider, apiKey: key });
            setKey(''); // never keep the key in the page after submitting
            if (res.ok) {
              setMsg({ text: t('keySaved'), tone: 'success' });
              router.refresh();
            } else setMsg({ text: te(res.error), tone: 'error' });
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label={t('provider')} htmlFor="prov">
            <Select id="prov" value={provider} onChange={(e) => setProvider(e.target.value as 'anthropic' | 'openai')}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </Select>
          </Field>
          <Field label={t('apiKey')} htmlFor="key" hint={t('apiKeyHint')}>
            <Input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" />
          </Field>
        </div>
        <p className="text-sm text-muted">{provider === 'anthropic' ? t('anthropicCaps') : t('openaiCaps')}</p>
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass('primary')} disabled={pending || key.trim().length < 20}>
            {configured.some((c) => c.provider === provider) ? t('replaceKey') : t('saveKey')}
          </button>
          <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
        </div>
      </form>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={t('removeKey')} closeLabel={tc('close')}>
        <p>{t('removeConfirm')}</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteApiKey(confirm!);
                setConfirm(null);
                if (res.ok) {
                  setMsg({ text: t('keyRemoved'), tone: 'success' });
                  router.refresh();
                } else setMsg({ text: te(res.error), tone: 'error' });
              })
            }
          >
            {t('removeKey')}
          </Button>
          <Button onClick={() => setConfirm(null)}>{tc('cancel')}</Button>
        </div>
      </Modal>
    </div>
  );
}

export function ChangePasswordForm() {
  const t = useTranslations('account');
  const te = useTranslations('errors');
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label={t('currentPassword')} htmlFor="pw-current">
        <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label={t('newPassword')} htmlFor="pw-new" hint={t('passwordHint')}>
        <Input id="pw-new" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label={t('confirmPassword')} htmlFor="pw-confirm">
        <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state?.error && <Alert tone="error">{te(state.error)}</Alert>}
      {state?.sent && <Alert tone="success">{t('passwordChanged')}</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t('passwordSaving') : t('passwordButton')}
        </Button>
      </div>
    </form>
  );
}

export function DeleteAccountForm({ username }: { username: string }) {
  const t = useTranslations('account');
  const te = useTranslations('errors');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await deleteAccount(value);
          if (res && !res.ok) setError(te(res.error));
        });
      }}
    >
      <Field label={t('deleteConfirmLabel', { username })} htmlFor="confirm-del">
        <Input id="confirm-del" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" autoCapitalize="none" />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <button type="submit" className={buttonClass('danger')} disabled={pending || value.trim().toLowerCase() !== username}>
          {pending ? t('deleting') : t('deleteButton')}
        </button>
      </div>
    </form>
  );
}
