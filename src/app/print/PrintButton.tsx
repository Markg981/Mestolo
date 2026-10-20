'use client';

import { useTranslations } from 'next-intl';
import { buttonClass } from '@/components/ui';

export function PrintButton() {
  const t = useTranslations('print');
  return (
    <div className="no-print mb-6 flex gap-2">
      <button type="button" onClick={() => window.print()} className={buttonClass('primary')}>
        {t('printButton')}
      </button>
      <button type="button" onClick={() => window.close()} className={buttonClass('ghost')}>
        {t('close')}
      </button>
    </div>
  );
}
