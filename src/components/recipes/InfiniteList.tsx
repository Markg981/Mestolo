'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { buttonClass } from '../ui';

/**
 * Appends server-rendered pages as the sentinel enters the viewport. The
 * "load more" button is always available (keyboard, no IntersectionObserver,
 * or after an offline error). Pages come from a server action (POST), which the
 * service worker never caches: the first page stays cached as before.
 */
export function InfiniteList({
  initialCursor,
  loadMore,
  children,
}: {
  initialCursor: string | null;
  loadMore: (cursor: string) => Promise<{ content: ReactNode; nextCursor: string | null }>;
  children: ReactNode;
}) {
  const t = useTranslations('pagination');
  const [pages, setPages] = useState<{ key: string; content: ReactNode }[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const next = useCallback(async () => {
    if (busy.current || !cursor) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const page = await loadMore(cursor);
      setPages((p) => [...p, { key: cursor, content: page.content }]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, loadMore]);

  useEffect(() => {
    const el = sentinel.current;
    // after an error, wait for an explicit retry instead of looping while offline
    if (!el || !cursor || failed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void next(), { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, failed, next]);

  return (
    <>
      <div className="flex flex-col gap-5">
        {children}
        {pages.map((p) => (
          <div key={p.key}>{p.content}</div>
        ))}
      </div>
      <div ref={sentinel} className="mt-8 flex flex-col items-center gap-3 text-sm text-muted" aria-live="polite">
        {loading && <p role="status">{t('loading')}</p>}
        {failed && <p role="alert">{t('error')}</p>}
        {cursor && !loading && (
          <button type="button" onClick={() => void next()} className={buttonClass('secondary')}>
            {failed ? t('retry') : t('loadMore')}
          </button>
        )}
        {!cursor && pages.length > 0 && <p>{t('end')}</p>}
      </div>
    </>
  );
}
