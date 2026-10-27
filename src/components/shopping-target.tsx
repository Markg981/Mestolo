'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui';
import type { ListOption } from '@/lib/shopping/targets';

/** Selettore della lista di destinazione; visibile solo se ce n'e piu di una. */
export function ShoppingTargetSelect({ lists, value, onChange }: { lists: ListOption[]; value: string; onChange: (id: string) => void }) {
  const t = useTranslations('shopping');
  const id = useId();
  if (lists.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted">
        {t('targetList')}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-auto">
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
