'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { createCollection, deleteCollection, renameCollection } from '@/app/actions/organize';
import { Modal } from '@/components/client-ui';
import { Alert, Button, Field, Input, Textarea, buttonClass } from '@/components/ui';

export function NewCollectionForm({ suggestions, showSuggestions }: { suggestions: string[]; showSuggestions: boolean }) {
  const t = useTranslations('collections');
  const te = useTranslations('errors');
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const create = (n: string) =>
    start(async () => {
      setError(null);
      const res = await createCollection(n);
      if (res.ok) {
        setName('');
        router.refresh();
      } else setError(te(res.error));
    });
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create(name.trim());
        }}
      >
        <label htmlFor="cname" className="sr-only">
          {t('name')}
        </label>
        <Input id="cname" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
        <button type="submit" className={buttonClass('primary')} disabled={pending || !name.trim()}>
          {t('create')}
        </button>
      </form>
      {showSuggestions && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{t('suggestionsLabel')}</span>
          {suggestions.map((s) => (
            <Button key={s} size="sm" disabled={pending} onClick={() => create(s)}>
              {s}
            </Button>
          ))}
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function CollectionAdmin({ id, name, description }: { id: string; name: string; description: string }) {
  const t = useTranslations('collections');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState<null | 'edit' | 'delete'>(null);
  const [n, setN] = useState(name);
  const [d, setD] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => setOpen('edit')}>
        {t('rename')}
      </Button>
      <Button size="sm" variant="ghost" className="text-tomato" onClick={() => setOpen('delete')}>
        {tc('delete')}
      </Button>
      <Modal open={open === 'edit'} onClose={() => setOpen(null)} title={t('rename')} closeLabel={tc('close')}>
        <Field label={t('name')} htmlFor="en">
          <Input id="en" value={n} maxLength={80} onChange={(e) => setN(e.target.value)} />
        </Field>
        <Field label={t('description')} htmlFor="ed">
          <Textarea id="ed" value={d} maxLength={500} onChange={(e) => setD(e.target.value)} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await renameCollection(id, n, d);
              if (res.ok) {
                setOpen(null);
                router.refresh();
              } else setError(te(res.error));
            })
          }
        >
          {tc('save')}
        </Button>
      </Modal>
      <Modal open={open === 'delete'} onClose={() => setOpen(null)} title={t('deleteTitle')} closeLabel={tc('close')}>
        <p>{t('deleteConfirm')}</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteCollection(id);
                if (res.ok) router.push('/collections');
                else setError(te(res.error));
              })
            }
          >
            {tc('delete')}
          </Button>
          <Button onClick={() => setOpen(null)}>{tc('cancel')}</Button>
        </div>
      </Modal>
    </div>
  );
}
