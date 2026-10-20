'use client';

import { useState } from 'react';
import { cx } from '@/components/ui';

const SIZES = { sm: 'size-8 text-sm', md: 'size-10 text-base', lg: 'size-24 text-3xl' } as const;

/**
 * Round avatar with initials as fallback. `hasImage` must come from a visibility-aware
 * source (get_avatar_paths / get_profile_card); the image itself is re-authorised by /api/avatars.
 */
export function Avatar({ userId, name, hasImage = false, size = 'md', className }: { userId: string; name: string; hasImage?: boolean; size?: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span aria-hidden="true" className={cx('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-saffron-wash font-bold text-ink', SIZES[size], className)}>
      {hasImage && !failed ? (
        <img src={`/api/avatars/${userId}`} alt="" className="size-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        initial
      )}
    </span>
  );
}
