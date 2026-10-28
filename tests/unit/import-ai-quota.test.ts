import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWav8 } from '@/lib/import/audio';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  enforceRateLimit: vi.fn(),
  resolveProvider: vi.fn(),
  recordUsage: vi.fn(),
  refundQuota: vi.fn(),
  completeJson: vi.fn(),
  transcribe: vi.fn(),
  prepareOcrPage: vi.fn(),
  draftFromExtraction: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig<object>()), enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/ai/service', () => ({ resolveProvider: mocks.resolveProvider, recordUsage: mocks.recordUsage }));
vi.mock('@/lib/ai/refund', () => ({ refundQuota: mocks.refundQuota }));
vi.mock('@/lib/ai/extraction', () => ({ draftFromExtraction: mocks.draftFromExtraction }));
vi.mock('@/lib/images/process', () => ({
  prepareOcrPage: mocks.prepareOcrPage,
  ImageValidationError: class ImageValidationError extends Error {
    code = 'image_invalid';
  },
}));
vi.mock('@/lib/import/video-import', () => ({ fetchVideoText: vi.fn() }));

import { importFromPhotos, importFromText, transcribeVideoAudio } from '@/app/actions/import';

function photoForm(n = 1) {
  const fd = new FormData();
  for (let i = 0; i < n; i++) fd.append('pages', new File([new Uint8Array([1, 2, 3])], `a${i}.jpg`, { type: 'image/jpeg' }));
  return fd;
}
function audioForm() {
  const fd = new FormData();
  fd.append('audio', new File([encodeWav8(new Float32Array(80)) as BlobPart],'a.wav', { type: 'audio/wav' }));
  return fd;
}

describe('import AI: quota consumata solo per richieste valide e rimborsata se falliscono', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ id: 'u1' });
    mocks.prepareOcrPage.mockResolvedValue(Buffer.from('jpeg'));
    mocks.draftFromExtraction.mockReturnValue({ content: {} });
    mocks.resolveProvider.mockResolvedValue({
      provider: { completeJson: mocks.completeJson, transcribe: mocks.transcribe },
      keySource: 'app',
      providerName: 'x',
    });
  });

  it('foto: rate limit superato -> la quota non viene consumata', async () => {
    mocks.enforceRateLimit.mockRejectedValue(new Error('rate_limited'));
    const r = await importFromPhotos(photoForm());
    expect(r.ok).toBe(false);
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });

  it('foto: immagine non valida -> la quota non viene consumata', async () => {
    mocks.prepareOcrPage.mockRejectedValue(new Error('bad image'));
    const r = await importFromPhotos(photoForm());
    expect(r.ok).toBe(false);
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });

  it('foto: 1 pagina = 1 unita, 8 pagine = 8 unita di quota', async () => {
    mocks.completeJson.mockResolvedValue({});
    await importFromPhotos(photoForm());
    expect(mocks.resolveProvider.mock.calls[0][4]).toBe(1);
    mocks.resolveProvider.mockClear();
    await importFromPhotos(photoForm(8));
    expect(mocks.resolveProvider.mock.calls[0].slice(1)).toEqual(['vision', 'vision', 'extract_photo', 8]);
  });

  it('foto: errore del provider con 8 pagine -> rimborso della risorsa con quantita 8', async () => {
    const resolved = { provider: { completeJson: mocks.completeJson }, keySource: 'app', providerName: 'x', quantity: 8 };
    mocks.resolveProvider.mockResolvedValue(resolved);
    mocks.completeJson.mockRejectedValue(new Error('boom'));
    await importFromPhotos(photoForm(8));
    expect(mocks.refundQuota).toHaveBeenCalledTimes(1);
    expect(mocks.refundQuota.mock.calls[0][1]).toBe(resolved);
  });

  it('foto: provider in errore -> rimborso', async () => {
    mocks.completeJson.mockRejectedValue(new Error('boom'));
    const r = await importFromPhotos(photoForm());
    expect(r.ok).toBe(false);
    expect(mocks.refundQuota).toHaveBeenCalledTimes(1);
    expect(mocks.refundQuota.mock.calls[0].slice(2)).toEqual(['vision', 'extract_photo']);
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  // Il provider ha gia' risposto (chiamata pagata): un output non valido non si rimborsa (C-05).
  it('foto: output non valido -> nessun rimborso', async () => {
    mocks.completeJson.mockResolvedValue({});
    mocks.draftFromExtraction.mockImplementation(() => {
      throw new Error('ai_bad_output');
    });
    const r = await importFromPhotos(photoForm());
    expect(r.ok).toBe(false);
    expect(mocks.refundQuota).not.toHaveBeenCalled();
  });

  it('foto: successo -> nessun rimborso', async () => {
    mocks.completeJson.mockResolvedValue({});
    const r = await importFromPhotos(photoForm());
    expect(r.ok).toBe(true);
    expect(mocks.refundQuota).not.toHaveBeenCalled();
    expect(mocks.recordUsage).toHaveBeenCalledTimes(1);
  });

  it('testo AI: provider in errore -> rimborso', async () => {
    mocks.completeJson.mockRejectedValue(new Error('boom'));
    const r = await importFromText('una ricetta abbastanza lunga', true);
    expect(r.ok).toBe(false);
    expect(mocks.refundQuota.mock.calls[0].slice(2)).toEqual(['text', 'extract_text']);
  });

  it('audio: rate limit prima della quota; provider in errore -> rimborso', async () => {
    mocks.enforceRateLimit.mockRejectedValueOnce(new Error('rate_limited'));
    expect((await transcribeVideoAudio(audioForm())).ok).toBe(false);
    expect(mocks.resolveProvider).not.toHaveBeenCalled();

    mocks.transcribe.mockRejectedValue(new Error('boom'));
    expect((await transcribeVideoAudio(audioForm())).ok).toBe(false);
    expect(mocks.refundQuota.mock.calls[0].slice(2)).toEqual(['text', 'transcribe']);
  });

  it('audio: trascrizione vuota -> nessun rimborso', async () => {
    mocks.transcribe.mockResolvedValue('');
    const r = await transcribeVideoAudio(audioForm());
    expect(r.ok).toBe(false);
    expect(mocks.refundQuota).not.toHaveBeenCalled();
  });
});
