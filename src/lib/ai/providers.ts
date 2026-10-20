import { redactSecrets } from '@/lib/crypto/secrets';

/**
 * Replaceable AI providers. They are plain HTTPS calls (no SDK) so that the
 * implementation is easy to audit and to mock in tests.
 */
export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';
export type Capability = 'text' | 'vision' | 'image';

export interface ImageInput {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface JsonRequest {
  system: string;
  user: string;
  images?: ImageInput[];
  maxTokens?: number;
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  capabilities: Capability[];
  completeJson(req: JsonRequest): Promise<unknown>;
  generateImage?(prompt: string): Promise<{ mime: string; base64: string }>;
}

export type AiErrorCode =
  | 'invalid_key'
  | 'provider_rate_limited'
  | 'provider_quota'
  | 'provider_error'
  | 'bad_output'
  | 'timeout'
  | 'not_configured'
  | 'quota_exceeded'
  | 'unsupported';

export class AiError extends Error {
  constructor(public code: AiErrorCode, detail?: string) {
    super(detail ? `${code}: ${redactSecrets(detail).slice(0, 300)}` : code);
  }
}

type FetchLike = typeof fetch;

function mapHttpError(status: number, body: string): AiError {
  if (status === 401 || status === 403) return new AiError('invalid_key');
  if (status === 429) {
    return /insufficient_quota|billing|credit/i.test(body) ? new AiError('provider_quota') : new AiError('provider_rate_limited');
  }
  if (status === 402) return new AiError('provider_quota');
  return new AiError('provider_error', `HTTP ${status}`);
}

/** Extracts the first JSON object from a model reply (tolerates ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AiError('bad_output', 'no JSON object in reply');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiError('bad_output', 'invalid JSON in reply');
  }
}

async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout');
    throw new AiError('provider_error', 'network error');
  }
  const text = await res.text();
  if (!res.ok) throw mapHttpError(res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('bad_output', 'provider returned non-JSON');
  }
}

export function anthropicProvider(opts: { apiKey: string; model: string; fetchImpl?: FetchLike }): AiProvider {
  const f = opts.fetchImpl ?? fetch;
  return {
    id: 'anthropic',
    label: 'Anthropic',
    capabilities: ['text', 'vision'],
    async completeJson(req) {
      const content: unknown[] = [
        ...(req.images ?? []).map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })),
        { type: 'text', text: req.user },
      ];
      const data = await postJson(
        f,
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
        { model: opts.model, max_tokens: req.maxTokens ?? 4000, system: req.system, messages: [{ role: 'user', content }] },
        90000,
      );
      const text = (data?.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
      return extractJson(text);
    },
  };
}

export function openAiProvider(opts: {
  apiKey: string;
  textModel: string;
  imageModel?: string;
  baseUrl?: string;
  compatible?: boolean;
  fetchImpl?: FetchLike;
}): AiProvider {
  const f = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const compatible = !!opts.compatible;
  const provider: AiProvider = {
    id: compatible ? 'openai-compatible' : 'openai',
    label: compatible ? 'OpenAI-compatible' : 'OpenAI',
    capabilities: opts.imageModel ? ['text', 'vision', 'image'] : ['text', 'vision'],
    async completeJson(req) {
      const userContent = req.images?.length
        ? [
            { type: 'text', text: req.user },
            ...req.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
          ]
        : req.user;
      const body: Record<string, unknown> = {
        model: opts.textModel,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: userContent },
        ],
      };
      if (compatible) body.max_tokens = req.maxTokens ?? 4000;
      else {
        body.max_completion_tokens = req.maxTokens ?? 4000;
        body.response_format = { type: 'json_object' };
      }
      const data = await postJson(f, `${base}/chat/completions`, { authorization: `Bearer ${opts.apiKey}` }, body, 90000);
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      return extractJson(text);
    },
  };
  if (opts.imageModel) {
    const model = opts.imageModel;
    provider.generateImage = async (prompt: string) => {
      const body: Record<string, unknown> = { model, prompt, n: 1, size: '1024x1024' };
      if (model.startsWith('dall-e')) body.response_format = 'b64_json';
      const data = await postJson(f, `${base}/images/generations`, { authorization: `Bearer ${opts.apiKey}` }, body, 120000);
      const b64: string | undefined = data?.data?.[0]?.b64_json;
      if (!b64) throw new AiError('bad_output', 'no image returned');
      return { mime: 'image/png', base64: b64 };
    };
  }
  return provider;
}
