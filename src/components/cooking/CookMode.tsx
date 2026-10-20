'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bell, ChevronLeft, ChevronRight, ListChecks, Mic, MicOff, Timer, X } from 'lucide-react';
import { formatQuantity } from '@/lib/recipes/ingredient-parser';
import { UNIT_KEYS } from '@/lib/recipes/units';
import type { Ingredient, Step } from '@/lib/recipes/types';
import { detectDurations, formatClock } from '@/lib/cooking/durations';
import { keyDirection, matchVoiceCommand, nextStep, parseCookState, prevStep, remainingSeconds, stepProgress, swipeDirection, type NavDirection } from '@/lib/cooking/navigation';
import { Button, cx } from '../ui';

interface CookTimer {
  id: string;
  label: string;
  endAt: number;
  done: boolean;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => RecognitionLike;

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

const storageKey = (id: string) => `mestolo-cook-${id}`;

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {}
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const nowMs = () => Date.now();

let audioCtx: AudioContext | null = null;
function beep() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    const ctx = audioCtx;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.35;
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch {}
}

/** Full-screen, hands-free cooking mode: one step at a time, ingredient checklist, timers, wake lock, voice. */
export function CookMode({ recipeId, title, ingredients, steps }: { recipeId: string; title: string; ingredients: Ingredient[]; steps: Step[] }) {
  const t = useTranslations('cook');
  const tu = useTranslations('units');
  const tr = useTranslations('recipe');
  const locale = useLocale();
  const total = steps.length;

  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [timers, setTimers] = useState<CookTimer[]>([]);
  const [now, setNow] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [wakeState, setWakeState] = useState<'on' | 'unsupported' | 'off'>('off');
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const firstRender = useRef(true);

  // Restore persisted state (client only, after hydration)
  useEffect(() => {
    const saved = parseCookState(readStorage(storageKey(recipeId)), ingredients.length, total);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only readable on the client, after hydration
    setStep(saved.step);
    setChecked(saved.checked);
    setHydrated(true);
    setVoiceSupported(getRecognitionCtor() !== null);
  }, [recipeId, ingredients.length, total]);

  useEffect(() => {
    if (hydrated) writeStorage(storageKey(recipeId), JSON.stringify({ step, checked }));
  }, [hydrated, recipeId, step, checked]);

  const go = useCallback(
    (dir: NavDirection) => {
      setStep((s) => (dir === 'next' ? nextStep(s, total) : prevStep(s, total)));
    },
    [total],
  );

  // Move focus to the step heading when the step changes (not on first paint)
  useEffect(() => {
    if (!hydrated) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepRef.current?.focus();
  }, [step, hydrated]);

  // Keyboard arrows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (sheet) {
        if (e.key === 'Escape') setSheet(false);
        return;
      }
      const dir = keyDirection(e.key);
      if (dir) {
        e.preventDefault();
        go(dir);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, sheet]);

  // Screen Wake Lock, re-acquired when the page becomes visible again
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection is client only
      setWakeState('unsupported');
      return;
    }
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
        setWakeState('on');
      } catch {
        setWakeState('off');
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  // Timer ticking (end timestamps, so backgrounded tabs stay accurate)
  const hasRunning = timers.some((x) => !x.done);
  const timersRef = useRef<CookTimer[]>([]);
  useEffect(() => {
    timersRef.current = timers;
  }, [timers]);
  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => {
      const tick = nowMs();
      setNow(tick);
      const finished = timersRef.current.filter((x) => !x.done && x.endAt <= tick);
      if (!finished.length) return;
      setTimers((all) => all.map((x) => (finished.some((f) => f.id === x.id) ? { ...x, done: true } : x)));
      for (const f of finished) {
        const msg = t('timerDone', { label: f.label });
        setAnnounce(msg);
        beep();
        try {
          navigator.vibrate?.([300, 150, 300, 150, 300]);
        } catch {}
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body: msg, tag: `mestolo-timer-${f.id}` });
        } catch {}
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [hasRunning, t, title]);

  const startTimer = (id: string, label: string, seconds: number) => {
    if (timers.some((x) => x.id === id && !x.done)) return;
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
    } catch {}
    const startedAt = nowMs();
    setNow(startedAt);
    setTimers((all) => [...all.filter((x) => x.id !== id), { id, label, endAt: startedAt + seconds * 1000, done: false }]);
    setAnnounce(t('timerStarted', { label }));
  };
  const stopTimer = (id: string) => setTimers((all) => all.filter((x) => x.id !== id));

  // Voice control (off by default)
  const recRef = useRef<RecognitionLike | null>(null);
  const wantVoice = useRef(false);
  const stopVoice = useCallback(() => {
    wantVoice.current = false;
    try {
      recRef.current?.stop();
    } catch {}
    recRef.current = null;
    setListening(false);
  }, []);
  const startVoice = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setVoiceError(false);
    const rec = new Ctor();
    rec.lang = locale;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const dir = matchVoiceCommand(e.results[i][0].transcript, locale);
        if (dir) go(dir);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setVoiceError(true);
        stopVoice();
      }
    };
    rec.onend = () => {
      // browsers end continuous sessions after a while: restart while the user wants voice on
      if (wantVoice.current) {
        try {
          rec.start();
        } catch {
          stopVoice();
        }
      } else setListening(false);
    };
    wantVoice.current = true;
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      stopVoice();
    }
  }, [go, locale, stopVoice]);
  useEffect(() => stopVoice, [stopVoice]);

  const unit = (u: string | null) => (!u ? '' : UNIT_KEYS.includes(u) ? tu(u) : u);
  const ingLabel = (ing: Ingredient) => {
    const qty = ing.toTaste ? tr('toTaste') : ing.quantity !== null ? `${formatQuantity(ing.quantity, locale, ing.quantityMax)} ${unit(ing.unit)}`.trim() : unit(ing.unit);
    return `${qty} ${ing.name}`.trim();
  };

  const current = steps[step];
  const durations = useMemo(() => (current ? detectDurations(current.text) : []), [current]);
  const progress = stepProgress(step, total);

  if (!total) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-porcelain p-6 text-center">
        <p className="text-lg">{t('noSteps')}</p>
        <Link href={`/recipes/${recipeId}`} className="text-basil underline underline-offset-4">
          {t('exit')}
        </Link>
      </div>
    );
  }

  const doneCount = checked.length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-porcelain text-ink"
      role="region"
      aria-label={t('regionLabel', { title })}
      onTouchStart={(e) => {
        const p = e.touches[0];
        touch.current = { x: p.clientX, y: p.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start || sheet) return;
        const p = e.changedTouches[0];
        const dir = swipeDirection(p.clientX - start.x, p.clientY - start.y);
        if (dir) go(dir);
      }}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Link href={`/recipes/${recipeId}`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold hover:bg-sunk" aria-label={t('exit')}>
          <X aria-hidden className="size-5" />
          <span className="hidden sm:inline">{t('exit')}</span>
        </Link>
        <p className="min-w-0 flex-1 truncate text-center font-semibold">{title}</p>
        {voiceSupported && (
          <Button
            variant={listening ? 'primary' : 'ghost'}
            className="size-11 px-0"
            aria-pressed={listening}
            aria-label={listening ? t('voiceOff') : t('voiceOn')}
            onClick={() => (listening ? stopVoice() : startVoice())}
          >
            {listening ? <Mic aria-hidden className="size-5" /> : <MicOff aria-hidden className="size-5" />}
          </Button>
        )}
        <Button variant="ghost" className="min-h-11 gap-1.5 px-3" aria-expanded={sheet} aria-controls="cook-ingredients" onClick={() => setSheet((v) => !v)}>
          <ListChecks aria-hidden className="size-5" />
          <span>{t('ingredients')}</span>
          <span className="tabular text-sm text-muted">
            {doneCount}/{ingredients.length}
          </span>
        </Button>
      </header>

      <div
        role="progressbar"
        aria-label={t('progress')}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step + 1}
        aria-valuetext={t('stepOf', { n: step + 1, total })}
        className="h-1.5 w-full bg-sunk"
      >
        <div className="h-full bg-saffron motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${Math.max(4, progress * 100)}%` }} />
      </div>

      {(listening || voiceError || wakeState === 'unsupported') && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-1.5 text-sm text-muted">
          {listening && (
            <span className="inline-flex items-center gap-2 font-semibold text-basil">
              <span aria-hidden className="size-2.5 rounded-full bg-tomato motion-safe:animate-pulse" />
              {t('listening')}
            </span>
          )}
          {voiceError && <span role="alert">{t('voiceDenied')}</span>}
          {wakeState === 'unsupported' && <span>{t('wakeUnsupported')}</span>}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-6">
        <div className="flex w-full max-w-3xl flex-col gap-5">
          <p className="tabular text-center text-sm font-semibold uppercase tracking-wide text-muted">{t('stepOf', { n: step + 1, total })}</p>
          {current.section && <p className="text-center font-semibold text-basil">{current.section}</p>}
          <h1 ref={stepRef} tabIndex={-1} className="text-center text-3xl leading-snug font-bold outline-none sm:text-4xl lg:text-5xl">
            {current.text}
          </h1>
          {durations.length > 0 && (
            <ul className="flex flex-wrap justify-center gap-2" aria-label={t('timers')}>
              {durations.map((d) => {
                const id = `${step}:${d.start}`;
                const timer = timers.find((x) => x.id === id);
                const running = timer && !timer.done;
                return (
                  <li key={id}>
                    <Button
                      variant={running ? 'primary' : 'secondary'}
                      className="min-h-12 gap-2 text-lg"
                      onClick={() => (running ? stopTimer(id) : startTimer(id, d.label, d.seconds))}
                      aria-label={running ? t('timerStop', { label: d.label }) : t('timerStart', { label: d.label })}
                    >
                      <Timer aria-hidden className="size-5" />
                      <span className="tabular">{running ? formatClock(remainingSeconds(timer.endAt, now)) : formatClock(d.seconds)}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      {timers.length > 0 && (
        <ul className="flex flex-wrap items-center justify-center gap-2 border-t border-line bg-surface px-3 py-2" aria-label={t('activeTimers')}>
          {timers.map((tm) => (
            <li key={tm.id} className={cx('inline-flex items-center gap-2 rounded-full border px-3 py-1.5', tm.done ? 'border-tomato bg-tomato text-white' : 'border-line bg-porcelain')}>
              {tm.done ? <Bell aria-hidden className="size-4" /> : <Timer aria-hidden className="size-4" />}
              <span className="text-sm">{tm.label}</span>
              <span className="tabular font-bold">{tm.done ? t('timerEnded') : formatClock(remainingSeconds(tm.endAt, now))}</span>
              <button type="button" className="inline-flex size-8 items-center justify-center rounded-full hover:bg-black/10" aria-label={t('timerDismiss', { label: tm.label })} onClick={() => stopTimer(tm.id)}>
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <nav className="flex items-center gap-3 border-t border-line px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" aria-label={t('navigation')}>
        <Button size="lg" variant="secondary" className="flex-1" disabled={step === 0} onClick={() => go('prev')}>
          <ChevronLeft aria-hidden className="size-6" />
          {t('prev')}
        </Button>
        <Button size="lg" variant="primary" className="flex-1" disabled={step === total - 1} onClick={() => go('next')}>
          {t('next')}
          <ChevronRight aria-hidden className="size-6" />
        </Button>
      </nav>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {t('stepOf', { n: step + 1, total })}: {current.text}
      </p>
      <p className="sr-only" role="status" aria-live="assertive">
        {announce}
      </p>

      {sheet && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/50" onClick={() => setSheet(false)}>
          <section
            id="cook-ingredients"
            role="dialog"
            aria-modal="true"
            aria-label={t('ingredients')}
            className="flex max-h-[80%] flex-col rounded-t-3xl bg-porcelain shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
              <h2 className="text-lg font-bold">{t('ingredients')}</h2>
              <Button variant="ghost" className="size-11 px-0" aria-label={t('closeIngredients')} onClick={() => setSheet(false)} autoFocus>
                <X aria-hidden className="size-5" />
              </Button>
            </div>
            <ul className="overflow-y-auto px-4 py-2">
              {ingredients.map((ing, i) => {
                const header = ing.section && (i === 0 || ingredients[i - 1].section !== ing.section) ? ing.section : null;
                const isChecked = checked.includes(i);
                return (
                  <li key={i}>
                    {header && <p className="pt-3 text-sm font-semibold text-basil">{header}</p>}
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 py-1.5 text-lg">
                      <input
                        type="checkbox"
                        className="size-6 shrink-0 accent-[var(--color-basil)]"
                        checked={isChecked}
                        onChange={() => setChecked((c) => (c.includes(i) ? c.filter((n) => n !== i) : [...c, i]))}
                      />
                      <span className={cx(isChecked && 'text-muted line-through')}>{ingLabel(ing)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
