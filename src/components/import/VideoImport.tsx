'use client';

import { useActionTransition } from '@/lib/run-action';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Film } from 'lucide-react';
import { transcribeVideoAudio } from '@/app/actions/import';
import { AudioExtractError, extractSpeechWav } from '@/lib/import/audio';
import { MAX_VIDEO_FILE_BYTES } from '@/lib/import/limits';
import { TextParseBox } from './TextParseBox';
import type { AiStatusProps } from '../recipes/RecipeIslands';
import { Alert, Button } from '../ui';
import type { ImportDraft } from '@/lib/recipes/types';

export type VideoSource = 'description' | 'captions' | 'transcription' | 'none';
export interface VideoText {
  source: VideoSource;
  text: string;
  /** Page URL of a platform video; null for uploaded files. */
  sourceUrl: string | null;
}

/** Shows where the text came from, lets the user edit it, then hands it to the usual text parser. */
export function VideoTextStep({ video, status, onDraft, onTranscribed }: { video: VideoText; status: AiStatusProps; onDraft: (d: ImportDraft) => void; onTranscribed: (v: VideoText) => void }) {
  const t = useTranslations('videoImport');
  const none = video.source === 'none' || !video.text.trim();
  return (
    <section className="flex flex-col gap-3">
      <Alert tone={none ? 'info' : 'success'} title={none ? t('noneTitle') : t(`source.${video.source}`)}>
        {none ? t('none') : t(`sourceHint.${video.source}`)}
      </Alert>
      {video.sourceUrl && (
        <VideoUpload status={status} onTranscribed={onTranscribed} compact />
      )}
      <TextParseBox key={`${video.source}:${video.text.length}`} initialText={video.text} sourceUrl={video.sourceUrl} status={status} onDraft={onDraft} />
    </section>
  );
}

/** Upload a video file: audio is extracted in the browser (never the whole video is sent), then transcribed with the AI option. */
export function VideoUpload({ status, onTranscribed, compact = false }: { status: AiStatusProps; onTranscribed: (v: VideoText) => void; compact?: boolean }) {
  const t = useTranslations('videoImport');
  const te = useTranslations('errors');
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'extract' | 'transcribe' | null>(null);
  const [pending, start] = useActionTransition();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_VIDEO_FILE_BYTES) {
      setError(t('fileTooBig'));
      return;
    }
    start(async () => {
      try {
        setBusy('extract');
        const wav = await extractSpeechWav(file);
        setBusy('transcribe');
        const fd = new FormData();
        fd.set('audio', new File([wav], 'audio.wav', { type: 'audio/wav' }));
        const res = await transcribeVideoAudio(fd);
        if (!res.ok) setError(te(res.error));
        else onTranscribed({ source: 'transcription', text: res.data.text, sourceUrl: null });
      } catch (e) {
        const code = e instanceof AudioExtractError ? e.code : 'decode_failed';
        setError(t(`extract.${code}`));
      } finally {
        setBusy(null);
        if (input.current) input.current.value = '';
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="font-semibold">{compact ? t('uploadTitleCompact') : t('uploadTitle')}</h2>
      <p className="text-sm text-muted">{t('uploadLead')}</p>
      <input ref={input} type="file" accept="video/*,audio/*" className="sr-only" id="video-file" onChange={(e) => onFile(e.target.files?.[0])} />
      <div>
        <Button disabled={pending || !status.available} onClick={() => input.current?.click()}>
          <Film aria-hidden className="size-5" />
          {busy === 'extract' ? t('extracting') : busy === 'transcribe' ? t('transcribing') : t('upload')}
        </Button>
      </div>
      {!status.available && <p className="text-sm text-muted">{t('needsAi')}</p>}
      <p className="text-sm text-muted">{t('uploadLimits')}</p>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
