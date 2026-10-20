import 'server-only';
import dns from 'node:dns';
import { Agent, request } from 'undici';
import { UnsafeUrlError, resolvePublicAddresses, validateExternalUrl, type LookupFn } from './ssrf';

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

export class FetchFailedError extends Error {
  constructor(public code: 'timeout' | 'http_error' | 'too_large' | 'content_type' | 'network', public status?: number) {
    super(code);
  }
}

const defaultLookup: LookupFn = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true }).then((r) => r.map((a) => ({ address: a.address, family: a.family })));

/**
 * The agent's connect-time lookup re-validates every address, so the IP we
 * connect to is the one we checked (protection against DNS rebinding).
 */
function makeAgent(lookup: LookupFn) {
  return new Agent({
    headersTimeout: 8000,
    bodyTimeout: 8000,
    connect: {
      timeout: 5000,
      lookup: (hostname: string, options: unknown, callback: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
        const wantsAll = typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
        resolvePublicAddresses(hostname, lookup)
          .then((addrs) => {
            if (wantsAll) callback(null, addrs);
            else callback(null, addrs[0].address, addrs[0].family);
          })
          .catch((e) => callback(e as Error, ''));
      },
    },
  });
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  allowedContentTypes?: RegExp;
  lookup?: LookupFn;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 4;
  const lookup = opts.lookup ?? defaultLookup;
  const agent = makeAgent(lookup);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 12000);

  let url = validateExternalUrl(rawUrl);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      await resolvePublicAddresses(url.hostname, lookup); // fail fast with a clear error
      let res;
      try {
        res = await request(url, {
          dispatcher: agent,
          method: 'GET',
          signal,
          headers: {
            'user-agent': 'MestoloRecipeImporter/1.0 (+https://github.com/Markg981/Mestolo)',
            accept: opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
            'accept-language': 'it,en;q=0.8,*;q=0.5',
          },
        });
      } catch (e) {
        if (e instanceof UnsafeUrlError) throw e;
        const err = e as { name?: string; cause?: unknown };
        if (err.cause instanceof UnsafeUrlError) throw err.cause;
        if (err.name === 'TimeoutError' || err.name === 'AbortError' || signal.aborted) throw new FetchFailedError('timeout');
        throw new FetchFailedError('network');
      }

      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        await res.body.dump();
        const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
        url = validateExternalUrl(new URL(loc, url).toString());
        continue;
      }
      if (res.statusCode >= 400) {
        await res.body.dump();
        throw new FetchFailedError('http_error', res.statusCode);
      }

      const ct = String(res.headers['content-type'] ?? '');
      if (opts.allowedContentTypes && !opts.allowedContentTypes.test(ct)) {
        await res.body.dump();
        throw new FetchFailedError('content_type');
      }

      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared && declared > maxBytes * 2) {
        await res.body.dump();
        throw new FetchFailedError('too_large');
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > maxBytes) {
          chunks.push(buf.subarray(0, buf.length - (size - maxBytes)));
          truncated = true;
          res.body.destroy();
          break;
        }
        chunks.push(buf);
      }
      return { finalUrl: url.toString(), status: res.statusCode, contentType: ct, body: Buffer.concat(chunks), truncated };
    }
    throw new UnsafeUrlError('too_many_redirects');
  } finally {
    agent.close().catch(() => undefined);
  }
}
