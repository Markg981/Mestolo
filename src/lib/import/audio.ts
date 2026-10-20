import { MAX_AUDIO_SECONDS } from './limits';

/** Speech-grade target: mono, 8 kHz, 8-bit PCM = 8 KB/s (about 8 minutes in 4 MB). */
export const AUDIO_SAMPLE_RATE = 8000;

/** Encodes mono float samples (-1..1) as an 8-bit unsigned PCM WAV file. */
export function encodeWav8(samples: Float32Array, sampleRate = AUDIO_SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate, true); // byte rate (1 byte per sample)
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, samples.length, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[44 + i] = Math.round((s + 1) * 127.5);
  }
  return out;
}

export class AudioExtractError extends Error {
  constructor(public code: 'too_long' | 'decode_failed' | 'unsupported') {
    super(code);
  }
}

/** Browser only: decodes the audio track of a video/audio file and returns a small speech WAV. */
export async function extractSpeechWav(file: File): Promise<Blob> {
  const Ctx = typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  if (!Ctx || typeof OfflineAudioContext === 'undefined') throw new AudioExtractError('unsupported');
  const ctx = new Ctx();
  try {
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new AudioExtractError('decode_failed');
    }
    if (decoded.duration > MAX_AUDIO_SECONDS) throw new AudioExtractError('too_long');
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination); // channels are down-mixed to mono by the destination
    src.start();
    const rendered = await off.startRendering();
    return new Blob([encodeWav8(rendered.getChannelData(0)) as BlobPart], { type: 'audio/wav' });
  } finally {
    void ctx.close();
  }
}
