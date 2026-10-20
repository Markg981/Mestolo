/**
 * Provider tests use a MOCKED fetch (declared explicitly). They verify request
 * shape, key handling and output validation — NOT the real provider services.
 */
import { describe, expect, it, vi } from 'vitest';
import { AiError, anthropicProvider, extractJson, openAiProvider } from '@/lib/ai/providers';
import { draftFromExtraction } from '@/lib/ai/extraction';

function mockFetch(status: number, body: unknown) {
  return vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

describe('anthropic provider (mocked fetch)', () => {
  it('sends images + text and parses the JSON reply', async () => {
    const f = mockFetch(200, { content: [{ type: 'text', text: '```json\n{"title":"Pizza"}\n```' }] });
    const p = anthropicProvider({ apiKey: 'sk-ant-secret-key-123456', model: 'test-model', fetchImpl: f as unknown as typeof fetch });
    const out = await p.completeJson({ system: 'S', user: 'U', images: [{ mime: 'image/jpeg', base64: 'AAAA' }] });
    expect(out).toEqual({ title: 'Pizza' });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    const headers = (init!.headers ?? {}) as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-secret-key-123456');
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe('test-model');
    expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg', data: 'AAAA' } });
    expect(String(url)).not.toContain('secret');
  });

  it('maps auth errors without leaking the key', async () => {
    const f = mockFetch(401, { error: { message: 'invalid x-api-key sk-ant-secret-key-123456' } });
    const p = anthropicProvider({ apiKey: 'sk-ant-secret-key-123456', model: 'm', fetchImpl: f as unknown as typeof fetch });
    const err = (await p.completeJson({ system: 's', user: 'u' }).catch((e) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('invalid_key');
    expect(String(err.message)).not.toContain('secret-key');
  });

  it('distinguishes rate limits from exhausted credit', async () => {
    const p1 = anthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: mockFetch(429, 'slow down') as unknown as typeof fetch });
    await expect(p1.completeJson({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'provider_rate_limited' });
    const p2 = openAiProvider({ apiKey: 'k', textModel: 'm', fetchImpl: mockFetch(429, { error: { code: 'insufficient_quota' } }) as unknown as typeof fetch });
    await expect(p2.completeJson({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'provider_quota' });
  });
});

describe('openai provider (mocked fetch)', () => {
  it('uses bearer auth, json mode and data URLs for images', async () => {
    const f = mockFetch(200, { choices: [{ message: { content: '{"ok":true}' } }] });
    const p = openAiProvider({ apiKey: 'sk-test-abcdef123456', textModel: 'gpt-x', fetchImpl: f as unknown as typeof fetch });
    await p.completeJson({ system: 'S', user: 'U', images: [{ mime: 'image/png', base64: 'BBBB' }] });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test-abcdef123456');
    const body = JSON.parse(String(init!.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/png;base64,BBBB');
  });

  it('openai-compatible omits json mode and uses the configured base URL', async () => {
    const f = mockFetch(200, { choices: [{ message: { content: 'Here: {"a":1}' } }] });
    const p = openAiProvider({ apiKey: 'k', textModel: 'llama', baseUrl: 'https://llm.example/v1/', compatible: true, fetchImpl: f as unknown as typeof fetch });
    expect(await p.completeJson({ system: 's', user: 'u' })).toEqual({ a: 1 });
    expect(String(f.mock.calls[0][0])).toBe('https://llm.example/v1/chat/completions');
    expect(JSON.parse(String(f.mock.calls[0][1]!.body)).response_format).toBeUndefined();
  });

  it('generates images only when an image model is configured', async () => {
    const noImg = openAiProvider({ apiKey: 'k', textModel: 'm' });
    expect(noImg.generateImage).toBeUndefined();
    expect(noImg.capabilities).not.toContain('image');
    const f = mockFetch(200, { data: [{ b64_json: 'iVBOR' }] });
    const p = openAiProvider({ apiKey: 'k', textModel: 'm', imageModel: 'gpt-image-1', fetchImpl: f as unknown as typeof fetch });
    expect(await p.generateImage!('a cake')).toEqual({ mime: 'image/png', base64: 'iVBOR' });
  });

  it('rejects replies without JSON', () => {
    expect(() => extractJson('sorry, I cannot')).toThrow(AiError);
  });
});

describe('extraction output normalisation', () => {
  it('keeps missing values null, flags low confidence and normalises units', () => {
    const d = draftFromExtraction(
      {
        language: 'it',
        title: 'Torta della nonna',
        servings: null,
        prep_minutes: 20,
        cook_minutes: null,
        total_minutes: null,
        ingredients: [
          { name: 'farina', quantity: 300, unit: 'grammi', confidence: 'high' },
          { name: 'zucchero', quantity: null, unit: null, confidence: 'low' },
        ],
        steps: [{ text: 'Impastare', confidence: 'high' }, { text: 'Infornare a ?? gradi', confidence: 'low' }],
        uncertain: ['prep_minutes'],
        warnings: [{ code: 'missing_page', page: 2, message: 'La ricetta sembra continuare' }],
      },
      { type: 'photo', method: 'ai' },
    );
    expect(d.content.servings).toBeNull();
    expect(d.field_flags.servings).toEqual(['missing']);
    expect(d.field_flags.prep_minutes).toEqual(['low_confidence']);
    expect(d.content.ingredients[0]).toMatchObject({ quantity: 300, unit: 'g' });
    expect(d.content.ingredients[1].flags).toEqual(['low_confidence', 'missing']);
    expect(d.content.steps[1].flags).toEqual(['low_confidence']);
    expect(d.warnings[0]).toMatchObject({ code: 'missing_page', page: 2 });
    expect(d.content.category_slug).toBe('desserts');
  });

  it('survives garbage fields from the model', () => {
    const d = draftFromExtraction({ title: 42, servings: 'many', ingredients: 'nope', steps: null }, { type: 'photo' });
    expect(d.content.title).toBe('');
    expect(d.content.servings).toBeNull();
    expect(d.content.ingredients).toEqual([]);
    expect(d.warnings.map((w) => w.code)).toEqual(['no_ingredients', 'no_steps']);
  });
});

describe('openai transcription (mocked fetch)', () => {
  it('posts multipart audio and returns the text', async () => {
    const f = mockFetch(200, { text: ' Taglia la cipolla ' });
    const p = openAiProvider({ apiKey: 'sk-test-key-123456', textModel: 'm', transcribeModel: 'whisper-1', fetchImpl: f as unknown as typeof fetch });
    const out = await p.transcribe!({ data: new Uint8Array([1, 2, 3]), mime: 'audio/wav', filename: 'audio.wav' });
    expect(out).toBe('Taglia la cipolla');
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init!.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get('model')).toBe('whisper-1');
    expect(p.capabilities).toContain('audio');
  });
  it('maps provider errors', async () => {
    const p = openAiProvider({ apiKey: 'k', textModel: 'm', fetchImpl: mockFetch(401, 'no') as unknown as typeof fetch });
    await expect(p.transcribe!({ data: new Uint8Array([1]), mime: 'audio/wav', filename: 'a.wav' })).rejects.toMatchObject({ code: 'invalid_key' });
  });
});
