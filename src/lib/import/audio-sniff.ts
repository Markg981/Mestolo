import { MAX_AUDIO_SECONDS } from './limits';

export type SniffedAudio = { mime: string; ext: string; kind: 'wav' | 'webm' | 'ogg' | 'mp4' | 'mp3' };

const ascii = (d: Uint8Array, o: number, s: string) => d.length >= o + s.length && [...s].every((c, i) => d[o + i] === c.charCodeAt(0));

/** Riconosce il formato dai magic byte (non si fida del MIME dichiarato dal client). */
export function sniffAudio(d: Uint8Array): SniffedAudio | null {
  if (ascii(d, 0, 'RIFF') && ascii(d, 8, 'WAVE')) return { mime: 'audio/wav', ext: 'wav', kind: 'wav' };
  if (d.length >= 4 && d[0] === 0x1a && d[1] === 0x45 && d[2] === 0xdf && d[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm', kind: 'webm' };
  if (ascii(d, 0, 'OggS')) return { mime: 'audio/ogg', ext: 'ogg', kind: 'ogg' };
  if (ascii(d, 4, 'ftyp')) return { mime: 'audio/mp4', ext: 'm4a', kind: 'mp4' };
  if (ascii(d, 0, 'ID3')) return { mime: 'audio/mpeg', ext: 'mp3', kind: 'mp3' };
  // Frame sync MPEG: 11 bit a 1, versione e layer validi.
  if (d.length >= 4 && d[0] === 0xff && (d[1] & 0xe0) === 0xe0 && ((d[1] >> 3) & 3) !== 1 && ((d[1] >> 1) & 3) !== 0) {
    return { mime: 'audio/mpeg', ext: 'mp3', kind: 'mp3' };
  }
  return null;
}

/** Bitrate minimo plausibile per il parlato compresso: 64 kbit/s = 8000 B/s. */
const MIN_COMPRESSED_BYTES_PER_SECOND = 8000;

/**
 * Durata in secondi. WAV: dal byte rate dell'header (esatto). Altri formati: byte / bitrate minimo
 * plausibile (nessuna libreria di decodifica nelle dipendenze; evita di aggiungerne una pesante).
 */
export function estimateAudioSeconds(d: Uint8Array, kind: SniffedAudio['kind']): number {
  if (kind === 'wav') {
    if (d.length < 44) return Infinity;
    const byteRate = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(28, true);
    return byteRate > 0 ? (d.length - 44) / byteRate : Infinity;
  }
  return d.length / MIN_COMPRESSED_BYTES_PER_SECOND;
}

export function audioWithinDuration(d: Uint8Array, kind: SniffedAudio['kind']): boolean {
  return estimateAudioSeconds(d, kind) <= MAX_AUDIO_SECONDS;
}
