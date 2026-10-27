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
