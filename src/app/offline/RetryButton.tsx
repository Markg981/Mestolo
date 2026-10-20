'use client';

import { buttonClass } from '@/components/ui';

export function RetryButton({ label }: { label: string }) {
  return (
    <button type="button" className={buttonClass('primary')} onClick={() => window.location.reload()}>
      {label}
    </button>
  );
}
