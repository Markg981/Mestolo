'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Mic, Send, X } from 'lucide-react';
import { askCookAssistant } from '@/app/actions/cook-assistant';
import { COOK_QUESTION_MAX, truncateHistory, type CookTurn } from '@/lib/cooking/assistant';
import { Button } from '../ui';

interface DictationLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type DictationCtor = new () => DictationLike;

function dictationCtor(): DictationCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: DictationCtor; webkitSpeechRecognition?: DictationCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** "Ask the assistant" bottom sheet for cooking mode. Never throws into the cooking UI: all failures become messages. */
export function CookAssistant({ recipeId, stepIndex, servings, available, onClose }: { recipeId: string; stepIndex: number; servings: number | null; available: boolean; onClose: () => void }) {
  const t = useTranslations('cook');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [turns, setTurns] = useState<CookTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [dictating, setDictating] = useState(false);
  const [canDictate, setCanDictate] = useState(false);
  const recRef = useRef<DictationLike | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection is client only
    setCanDictate(dictationCtor() !== null);
    return () => {
      try {
        recRef.current?.stop();
      } catch {}
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, pending]);

  const submit = () => {
    const q = question.trim();
    if (!q || pending) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError(t('assistOffline'));
      return;
    }
    setError(null);
    const history = truncateHistory(turns);
    setTurns((all) => [...all, { role: 'user', text: q }]);
    setQuestion('');
    start(async () => {
      try {
        const res = await askCookAssistant(recipeId, { question: q, history, stepIndex, servings });
        if (res.ok) setTurns((all) => [...all, { role: 'assistant', text: res.data.answer }]);
        else setError(te.has(res.error) ? te(res.error) : te('generic'));
      } catch {
        setError(typeof navigator !== 'undefined' && navigator.onLine === false ? t('assistOffline') : te('generic'));
      }
    });
  };

  const toggleDictation = () => {
    if (dictating) {
      try {
        recRef.current?.stop();
      } catch {}
      return;
    }
    const Ctor = dictationCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = locale;
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }>>)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (text) setQuestion((q) => `${q} ${text}`.trim().slice(0, COOK_QUESTION_MAX));
    };
    rec.onend = () => setDictating(false);
    rec.onerror = () => setDictating(false);
    recRef.current = rec;
    try {
      rec.start();
      setDictating(true);
    } catch {
      setDictating(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/50" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <section role="dialog" aria-modal="true" aria-label={t('assistTitle')} className="flex max-h-[85%] flex-col rounded-t-3xl bg-porcelain shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="text-lg font-bold">{t('assistTitle')}</h2>
          <Button variant="ghost" className="size-11 px-0" aria-label={t('assistClose')} onClick={onClose} autoFocus>
            <X aria-hidden className="size-5" />
          </Button>
        </div>

        {!available ? (
          <div className="flex flex-col gap-3 px-4 py-5">
            <p>{t('assistUnavailable')}</p>
            <Link href="/settings/ai" className="inline-flex min-h-11 items-center self-start text-basil underline underline-offset-4">
              {t('assistSettings')}
            </Link>
          </div>
        ) : (
          <>
            <div className="min-h-24 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
              {turns.length === 0 && <p className="text-muted">{t('assistEmpty')}</p>}
              <ul className="flex flex-col gap-3">
                {turns.map((m, i) => (
                  <li key={i} className={m.role === 'user' ? 'self-end rounded-2xl bg-sunk px-3 py-2' : 'self-start rounded-2xl border border-line bg-surface px-3 py-2'}>
                    <span className="sr-only">{m.role === 'user' ? t('assistYou') : t('assistAnswer')}: </span>
                    <span className="whitespace-pre-wrap">{m.text}</span>
                  </li>
                ))}
                {pending && <li className="self-start text-muted">{t('assistThinking')}</li>}
              </ul>
              <div ref={endRef} />
            </div>
            {error && (
              <p role="alert" className="px-4 pb-1 text-sm text-tomato">
                {error}
              </p>
            )}
            <form
              className="flex items-end gap-2 border-t border-line px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <textarea
                className="min-h-12 flex-1 resize-none rounded-2xl border border-line bg-surface px-3 py-2 text-base"
                rows={2}
                maxLength={COOK_QUESTION_MAX}
                value={question}
                placeholder={t('assistPlaceholder')}
                aria-label={t('assistPlaceholder')}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {canDictate && (
                <Button type="button" variant={dictating ? 'primary' : 'ghost'} className="size-12 px-0" aria-pressed={dictating} aria-label={dictating ? t('assistDictating') : t('assistDictate')} onClick={toggleDictation}>
                  <Mic aria-hidden className="size-5" />
                </Button>
              )}
              <Button type="submit" variant="primary" className="size-12 px-0" disabled={pending || !question.trim()} aria-label={t('assistSend')}>
                <Send aria-hidden className="size-5" />
              </Button>
            </form>
            <p className="px-4 pb-2 text-xs text-muted">{t('assistDisclaimer')}</p>
          </>
        )}
      </section>
    </div>
  );
}
