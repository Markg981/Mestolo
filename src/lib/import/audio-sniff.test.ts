import { describe, expect, it } from 'vitest';
import { encodeWav8 } from './audio';
import { audioWithinDuration, estimateAudioSeconds, sniffAudio } from './audio-sniff';
import { MAX_AUDIO_SECONDS } from './limits';

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniffAudio', () => {
  it('riconosce WAV', () => {
    expect(sniffAudio(encodeWav8(new Float32Array(10)))).toMatchObject({ mime: 'audio/wav', ext: 'wav' });
  });
  it('riconosce webm, ogg, mp4, mp3', () => {
    expect(sniffAudio(bytes(0x1a, 0x45, 0xdf, 0xa3))?.ext).toBe('webm');
    expect(sniffAudio(text('OggS\0\0\0\0'))?.ext).toBe('ogg');
    expect(sniffAudio(text('\0\0\0\x20ftypM4A '))?.ext).toBe('m4a');
    expect(sniffAudio(text('ID3\x04\0\0\0\0\0\0'))?.ext).toBe('mp3');
    expect(sniffAudio(bytes(0xff, 0xfb, 0x90, 0x00))?.ext).toBe('mp3');
  });
  it('rifiuta file falsi', () => {
    expect(sniffAudio(text('<html>not audio</html>'))).toBeNull();
    expect(sniffAudio(text('MZ\x90\0exe'))).toBeNull();
    expect(sniffAudio(new Uint8Array(0))).toBeNull();
  });
});

describe('tetto di durata', () => {
  it('WAV: durata esatta dall header', () => {
    const wav = encodeWav8(new Float32Array(8000 * 10));
    expect(estimateAudioSeconds(wav, 'wav')).toBeCloseTo(10);
    expect(audioWithinDuration(wav, 'wav')).toBe(true);
  });
  it('WAV oltre il tetto rifiutato', () => {
    expect(audioWithinDuration(encodeWav8(new Float32Array(8000 * (MAX_AUDIO_SECONDS + 5))), 'wav')).toBe(false);
  });
  it('WAV con byte rate 0 rifiutato', () => {
    const wav = encodeWav8(new Float32Array(100));
    new DataView(wav.buffer).setUint32(28, 0, true);
    expect(audioWithinDuration(wav, 'wav')).toBe(false);
  });
  it('formati compressi: stima byte/bitrate', () => {
    expect(audioWithinDuration(new Uint8Array(1_000_000), 'mp3')).toBe(true);
    expect(audioWithinDuration(new Uint8Array(8000 * (MAX_AUDIO_SECONDS + 5)), 'mp3')).toBe(false);
  });
});

// Contenitori sintetici: solo l'header che serve alla lettura della durata, poi padding.
const pad = (head: number[], total: number) => {
  const a = new Uint8Array(total);
  a.set(head);
  return a;
};
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const chars = (s: string) => [...s].map((c) => c.charCodeAt(0));
const SIZE = 3_500_000; // sotto MAX_AUDIO_BYTES

function mp3(frames: number): Uint8Array {
  // MPEG1 L3 44,1 kHz stereo, 32 kbit/s; Xing a offset 4+32 con flag frame.
  const head = [0xff, 0xfb, 0x10, 0x00, ...new Array(32).fill(0), ...chars('Xing'), 0, 0, 0, 1, ...be32(frames)];
  return pad(head, SIZE);
}
function mp4(seconds: number): Uint8Array {
  const mvhd = [...be32(28), ...chars('mvhd'), 0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(seconds * 1000)];
  const moov = [...be32(8 + mvhd.length), ...chars('moov'), ...mvhd];
  return pad([...be32(16), ...chars('ftypM4A '), ...be32(0), ...moov], SIZE);
}
function ogg(seconds: number): Uint8Array {
  const a = new Uint8Array(SIZE);
  a.set(chars('OggS'), 0);
  a.set(chars('OpusHead'), 28);
  const o = SIZE - 100;
  a.set(chars('OggS'), o);
  a.set(le32(seconds * 48000), o + 6);
  return a;
}
function webm(seconds: number): Uint8Array {
  const dur = new Uint8Array(8);
  new DataView(dur.buffer).setFloat64(0, seconds * 1000);
  const info = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x44, 0x89, 0x88, ...dur];
  const infoEl = [0x15, 0x49, 0xa9, 0x66, 0x80 | info.length, ...info];
  return pad([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 0, 0, 0, 0, 0, 0, 0xff, ...infoEl], SIZE);
}

describe('durata letta dai container', () => {
  it('MP3 Xing: sotto e sopra il tetto', () => {
    const fps = 44100 / 1152;
    expect(audioWithinDuration(mp3(Math.floor(fps * 400)), 'mp3')).toBe(true);
    expect(audioWithinDuration(mp3(Math.floor(fps * 1800)), 'mp3')).toBe(false);
    expect(estimateAudioSeconds(mp3(Math.floor(fps * 100)), 'mp3')).toBeCloseTo(100, 0);
  });
  it('MP3 senza Xing: stima CBR dal bitrate del primo frame', () => {
    // 32 kbit/s = 4000 B/s: 3,5 MB sono ~875 s.
    expect(audioWithinDuration(pad([0xff, 0xfb, 0x10, 0x00], SIZE), 'mp3')).toBe(false);
  });
  it('MP4 mvhd', () => {
    expect(audioWithinDuration(mp4(400), 'mp4')).toBe(true);
    expect(audioWithinDuration(mp4(1800), 'mp4')).toBe(false);
  });
  it('OGG/Opus: ultimo granule position', () => {
    expect(audioWithinDuration(ogg(400), 'ogg')).toBe(true);
    expect(audioWithinDuration(ogg(1800), 'ogg')).toBe(false);
  });
  it('WebM Duration', () => {
    expect(audioWithinDuration(webm(400), 'webm')).toBe(true);
    expect(audioWithinDuration(webm(1800), 'webm')).toBe(false);
  });
  it('durata dichiarata incoerente coi byte reali rifiutata', () => {
    expect(audioWithinDuration(mp4(5), 'mp4')).toBe(false);
  });
  it('durata illeggibile: il ripiego rende effettivo il tetto fino a MAX_AUDIO_BYTES', () => {
    for (const kind of ['webm', 'ogg', 'mp4', 'mp3'] as const) {
      expect(audioWithinDuration(new Uint8Array(3_670_016), kind)).toBe(false);
      expect(audioWithinDuration(new Uint8Array(1_000_000), kind)).toBe(true);
    }
  });
  it('WAV con byte rate incoerente col formato rifiutato', () => {
    const wav = encodeWav8(new Float32Array(8000 * 10));
    new DataView(wav.buffer).setUint32(28, 1_000_000, true);
    expect(audioWithinDuration(wav, 'wav')).toBe(false);
  });
});

