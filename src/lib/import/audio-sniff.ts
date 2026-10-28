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


type Kind = SniffedAudio['kind'];

/**
 * Bitrate di ripiego quando la durata non si legge dal container: 40 kbit/s = 5000 B/s. E' volutamente
 * sotto MAX_AUDIO_BYTES / MAX_AUDIO_SECONDS (~7650 B/s), altrimenti il tetto non potrebbe mai scattare.
 */
const FALLBACK_BYTES_PER_SECOND = 5000;
/** Oltre 512 kbit/s per un contenitore compresso la durata dichiarata e' incoerente coi byte reali. */
const MAX_PLAUSIBLE_COMPRESSED_BYTES_PER_SECOND = 64000;

const u32be = (d: Uint8Array, o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);

function wavSeconds(d: Uint8Array): number {
  if (d.length < 44) return Infinity;
  const v = view(d);
  const channels = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const byteRate = v.getUint32(28, true);
  const bits = v.getUint16(34, true);
  // Il byte rate dichiarato dal client deve coincidere con quello derivato dal formato.
  if (byteRate === 0 || byteRate !== (sampleRate * channels * bits) / 8) return Infinity;
  return (d.length - 44) / byteRate;
}

// Bitrate (kbit/s) per indice: MPEG1 L1, L2, L3 e MPEG2/2.5 L1, L2/L3.
const BR_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
const BR_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
const BR_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function mp3Seconds(d: Uint8Array): number | null {
  let o = 0;
  if (ascii(d, 0, 'ID3') && d.length >= 10) o = 10 + (((d[6] & 0x7f) << 21) | ((d[7] & 0x7f) << 14) | ((d[8] & 0x7f) << 7) | (d[9] & 0x7f));
  const limit = Math.min(d.length - 4, o + 65536);
  for (; o < limit; o++) {
    if (d[o] !== 0xff || (d[o + 1] & 0xe0) !== 0xe0) continue;
    const ver = (d[o + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = 4 - ((d[o + 1] >> 1) & 3); // 1..3
    const bi = d[o + 2] >> 4;
    const ri = (d[o + 2] >> 2) & 3;
    if (ver === 1 || layer === 4 || bi === 0 || bi === 15 || ri === 3) continue;
    const table =
      ver === 3 ? (layer === 1 ? BR_V1_L1 : layer === 2 ? BR_V1_L2 : BR_V1_L3) : layer === 1 ? BR_V2_L1 : BR_V2_L23;
    const kbps = table[bi];
    const sr = MP3_RATES[ver][ri];
    const spf = layer === 1 ? 384 : layer === 3 && ver !== 3 ? 576 : 1152;
    // Header Xing/Info (VBR/CBR): numero di frame dichiarato dall'encoder.
    const mono = d[o + 3] >> 6 === 3;
    const side = ver === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const x = o + 4 + side;
    if ((ascii(d, x, 'Xing') || ascii(d, x, 'Info')) && d.length >= x + 12 && d[x + 7] & 1) {
      return (u32be(d, x + 8) * spf) / sr;
    }
    return (d.length - o) / ((kbps * 1000) / 8);
  }
  return null;
}

function oggSeconds(d: Uint8Array): number | null {
  let rate = 0;
  if (ascii(d, 28, 'OpusHead')) rate = 48000;
  else if (ascii(d, 29, 'vorbis') && d.length >= 44) rate = view(d).getUint32(40, true);
  if (!rate) return null;
  const v = view(d);
  const from = Math.max(0, d.length - 65536 - 14);
  for (let o = d.length - 14; o >= from; o--) {
    if (!ascii(d, o, 'OggS')) continue;
    const lo = v.getUint32(o + 6, true);
    const hi = v.getUint32(o + 10, true);
    if (hi === 0xffffffff && lo === 0xffffffff) return null; // granule -1: pagina senza fine pacchetto
    return (hi * 4294967296 + lo) / rate;
  }
  return null;
}

function mp4Seconds(d: Uint8Array): number | null {
  const v = view(d);
  const walk = (start: number, end: number, depth: number): number | null => {
    let o = start;
    while (o + 8 <= end) {
      let size = v.getUint32(o);
      let hdr = 8;
      if (size === 1) {
        if (o + 16 > end) return null;
        size = v.getUint32(o + 8) * 4294967296 + v.getUint32(o + 12);
        hdr = 16;
      } else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) return null;
      if (ascii(d, o + 4, 'mvhd')) {
        const p = o + hdr;
        if (d[p] === 1) {
          if (p + 32 > end) return null;
          const ts = v.getUint32(p + 20);
          return ts ? (v.getUint32(p + 24) * 4294967296 + v.getUint32(p + 28)) / ts : null;
        }
        if (p + 20 > end) return null;
        const ts = v.getUint32(p + 12);
        return ts ? v.getUint32(p + 16) / ts : null;
      }
      if (ascii(d, o + 4, 'moov') && depth === 0) return walk(o + hdr, o + size, 1);
      o += size;
    }
    return null;
  };
  return walk(0, d.length, 0);
}

function readVint(d: Uint8Array, o: number, keepMarker: boolean): { v: number; len: number } | null {
  const b = d[o];
  if (b === undefined || b === 0) return null;
  const len = Math.clz32(b) - 23;
  if (o + len > d.length) return null;
  let v = keepMarker ? b : b & (0xff >> len);
  for (let i = 1; i < len; i++) v = v * 256 + d[o + i];
  return { v, len };
}

function webmSeconds(d: Uint8Array): number | null {
  const v = view(d);
  let scale = 1_000_000;
  let duration: number | null = null;
  const walk = (start: number, end: number, depth: number): boolean => {
    let o = start;
    while (o < end) {
      const id = readVint(d, o, true);
      if (!id) return true;
      const sz = readVint(d, o + id.len, false);
      if (!sz) return true;
      const body = o + id.len + sz.len;
      const stop = Math.min(end, body + sz.v);
      if (id.v === 0x1f43b675) return true; // Cluster: le Info lo precedono sempre
      if (depth < 2 && (id.v === 0x18538067 || id.v === 0x1549a966)) {
        if (walk(body, stop, depth + 1)) return true;
      } else if (id.v === 0x2ad7b1 && sz.v <= 6) {
        let n = 0;
        for (let i = body; i < stop; i++) n = n * 256 + d[i];
        if (n > 0) scale = n;
      } else if (id.v === 0x4489 && (sz.v === 4 || sz.v === 8) && body + sz.v <= d.length) {
        duration = sz.v === 4 ? v.getFloat32(body) : v.getFloat64(body);
      }
      o = body + sz.v;
    }
    return false;
  };
  walk(0, d.length, 0);
  return duration !== null && Number.isFinite(duration) && duration > 0 ? (duration * scale) / 1e9 : null;
}

/**
 * Durata in secondi. WAV: dal byte rate dell'header, rifiutato se incoerente col formato. Altri formati:
 * durata letta dal container (MP3 Xing/frame, OGG ultimo granule, MP4 mvhd, WebM Duration); se non
 * leggibile, byte / bitrate minimo di ripiego. Una durata dichiarata incompatibile coi byte reali
 * (bitrate irrealistico) vale Infinity, cosi' non si puo' aggirare il tetto con un header falso.
 */
export function estimateAudioSeconds(d: Uint8Array, kind: Kind): number {
  if (kind === 'wav') return wavSeconds(d);
  let declared: number | null = null;
  try {
    declared = kind === 'mp3' ? mp3Seconds(d) : kind === 'ogg' ? oggSeconds(d) : kind === 'mp4' ? mp4Seconds(d) : webmSeconds(d);
  } catch {
    declared = null;
  }
  const fallback = d.length / FALLBACK_BYTES_PER_SECOND;
  if (declared === null || !Number.isFinite(declared) || declared <= 0) return fallback;
  if (d.length / declared > MAX_PLAUSIBLE_COMPRESSED_BYTES_PER_SECOND) return Infinity;
  return declared;
}

export function audioWithinDuration(d: Uint8Array, kind: Kind): boolean {
  return estimateAudioSeconds(d, kind) <= MAX_AUDIO_SECONDS;
}
