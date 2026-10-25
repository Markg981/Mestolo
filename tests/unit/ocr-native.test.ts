/** Native OCR adapter (ML Kit via Capacitor), with the plugins mocked: file lifecycle and geometry. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cap = vi.hoisted(() => ({ native: true, plugin: true }));
const fs = vi.hoisted(() => ({ writeFile: vi.fn(), deleteFile: vi.fn() }));
const mlkit = vi.hoisted(() => ({ processImage: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => cap.native, isPluginAvailable: (n: string) => cap.plugin && n === 'TextRecognition' },
}));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: fs, Directory: { Cache: 'CACHE' } }));
vi.mock('@capacitor-mlkit/text-recognition', () => ({ TextRecognition: mlkit }));

import { recognizeNative } from '@/lib/ocr/native';

/** Minimal FileReader for Node: readAsDataURL of a Blob. */
class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(b: Blob) {
    b.arrayBuffer().then((buf) => {
      this.result = `data:${b.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onload?.();
    });
  }
}

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const line = (text: string, b: ReturnType<typeof box> | undefined, extra: object = {}) => ({ text, boundingBox: b, cornerPoints: [], elements: [], ...extra });

describe('recognizeNative', () => {
  beforeEach(() => {
    cap.native = true;
    cap.plugin = true;
    vi.stubGlobal('FileReader', FakeFileReader);
    fs.writeFile.mockResolvedValue({ uri: 'file:///cache/ocr.jpg' });
    fs.deleteFile.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    ['not on a native platform', () => (cap.native = false)],
    ['the plugin is missing from the build', () => (cap.plugin = false)],
  ])('throws ocr_native_unavailable when %s, without touching the filesystem', async (_, set) => {
    set();
    await expect(recognizeNative(new Blob(['x']))).rejects.toThrow('ocr_native_unavailable');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('writes the image as base64 to the cache, reads it and deletes it', async () => {
    mlkit.processImage.mockResolvedValue({ text: 'ciao', blocks: [] });
    await expect(recognizeNative(new Blob(['abc'], { type: 'image/jpeg' }))).resolves.toBe('ciao');
    const arg = fs.writeFile.mock.calls[0][0];
    expect(arg).toMatchObject({ data: Buffer.from('abc').toString('base64'), directory: 'CACHE' });
    expect(arg.path).toMatch(/^ocr-\d+\.jpg$/);
    expect(mlkit.processImage).toHaveBeenCalledWith({ path: 'file:///cache/ocr.jpg' });
    expect(fs.deleteFile).toHaveBeenCalledWith({ path: 'file:///cache/ocr.jpg' });
  });

  it('deletes the temp file even when recognition fails, and a failed delete does not mask the result', async () => {
    mlkit.processImage.mockRejectedValueOnce(new Error('mlkit'));
    await expect(recognizeNative(new Blob(['x']))).rejects.toThrow('mlkit');
    expect(fs.deleteFile).toHaveBeenCalledTimes(1);
    fs.deleteFile.mockRejectedValueOnce(new Error('gone'));
    mlkit.processImage.mockResolvedValueOnce({ text: 'ok', blocks: [] });
    await expect(recognizeNative(new Blob(['x']))).resolves.toBe('ok');
  });

  it('rebuilds the reading order from geometry when every line has a box', async () => {
    // ML Kit returns the second column's block first
    mlkit.processImage.mockResolvedValue({
      text: 'unordered',
      blocks: [
        { lines: [line('Procedimento', box(600, 100, 900, 130)), line('Mescolare tutto', box(600, 140, 950, 170))] },
        { lines: [line('Ingredienti', box(50, 100, 300, 130)), line('200 g farina', box(50, 140, 320, 170))] },
      ],
    });
    const text = await recognizeNative(new Blob(['x']));
    expect(text).not.toBe('unordered');
    expect(text.indexOf('Ingredienti')).toBeLessThan(text.indexOf('Procedimento'));
    expect(text.indexOf('200 g farina')).toBeLessThan(text.indexOf('Procedimento'));
  });

  it('falls back to the plugin text when some line has no box', async () => {
    mlkit.processImage.mockResolvedValue({ text: 'testo grezzo', blocks: [{ lines: [line('a', box(0, 0, 10, 10)), line('b', undefined)] }] });
    await expect(recognizeNative(new Blob(['x']))).resolves.toBe('testo grezzo');
  });

  it('reads a tilted photo through the corner points without dropping words', async () => {
    const tilted = (text: string, y: number) =>
      line(text, box(50, y, 400, y + 30), {
        cornerPoints: [{ x: 50, y }, { x: 400, y: y + 20 }],
        elements: text.split(' ').map((t, i) => ({ text: t, boundingBox: box(50 + i * 80, y, 120 + i * 80, y + 30) })),
      });
    mlkit.processImage.mockResolvedValue({ text: '', blocks: [{ lines: [tilted('100 ml latte', 100), tilted('2 uova', 160)] }] });
    const text = await recognizeNative(new Blob(['x']));
    expect(text).toContain('100 ml latte');
    expect(text).toContain('2 uova');
  });
});
