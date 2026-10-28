import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type LookupCb = (err: Error | null, address: unknown, family?: number) => void;
type ConnectLookup = (host: string, options: unknown, cb: LookupCb) => void;

const state = vi.hoisted(() => ({
  agentOpts: [] as Array<{ connect: { lookup: unknown } }>,
  request: undefined as unknown as (url: URL, opts: { signal: AbortSignal; headers: Record<string, string> }) => Promise<unknown>,
}));

vi.mock('undici', () => ({
  Agent: class {
    constructor(opts: { connect: { lookup: unknown } }) {
      state.agentOpts.push(opts);
    }
    close() {
      return Promise.resolve();
    }
  },
  request: (url: URL, opts: { signal: AbortSignal; headers: Record<string, string> }) => state.request(url, opts),
}));

import { safeFetch } from '@/lib/import/safe-fetch';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function response(status: number, headers: Record<string, string>, chunks: Buffer[] = []) {
  const body = Readable.from(chunks) as Readable & { dump: () => Promise<void> };
  body.dump = async () => undefined;
  return { statusCode: status, headers, body };
}

beforeEach(() => {
  state.agentOpts.length = 0;
});

describe('safeFetch (undici mockato)', () => {
  it('blocca un redirect verso un IP privato letterale', async () => {
    const seen: string[] = [];
    state.request = async (url) => {
      seen.push(url.toString());
      return response(302, { location: 'http://169.254.169.254/latest/meta-data' });
    };
    await expect(safeFetch('https://ok.example/a', { lookup: publicLookup })).rejects.toMatchObject({ code: 'private_address' });
    expect(seen).toEqual(['https://ok.example/a']);
  });

  it('blocca un redirect verso un host che risolve a un indirizzo privato', async () => {
    const lookup = async (host: string) =>
      host === 'internal-alias.example' ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
    const seen: string[] = [];
    state.request = async (url) => {
      seen.push(url.hostname);
      return response(301, { location: 'https://internal-alias.example/x' });
    };
    await expect(safeFetch('https://ok.example/a', { lookup })).rejects.toMatchObject({ code: 'private_address' });
    expect(seen).toEqual(['ok.example']);
  });

  it('segue un redirect pubblico e dopo troppi redirect fallisce', async () => {
    let n = 0;
    state.request = async () => {
      n++;
      return response(302, { location: `https://ok.example/${n}` });
    };
    await expect(safeFetch('https://ok.example/0', { lookup: publicLookup, maxRedirects: 2 })).rejects.toMatchObject({ code: 'too_many_redirects' });
    expect(n).toBe(3);
  });

  it('DNS rebinding: la lookup di connessione rivalida ogni risoluzione', async () => {
    let calls = 0;
    const lookup = async () => (++calls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
    state.request = async () => response(200, { 'content-type': 'text/html' }, [Buffer.from('ok')]);
    await safeFetch('https://rebind.example/', { lookup });
    const connectLookup = state.agentOpts[0].connect.lookup as ConnectLookup;
    // la seconda risoluzione (al momento della connessione) ora punta a loopback
    const err = await new Promise<{ code?: string } | null>((resolve) => connectLookup('rebind.example', {}, (e) => resolve(e as { code?: string } | null)));
    expect(err).toMatchObject({ code: 'private_address' });
    // con risposta pubblica restituisce l'indirizzo validato (forma singola e all)
    calls = 0;
    const single = await new Promise<unknown[]>((resolve) => connectLookup('rebind.example', {}, (e, a, f) => resolve([e, a, f])));
    expect(single).toEqual([null, '93.184.216.34', 4]);
    calls = 0;
    const all = await new Promise<unknown[]>((resolve) => connectLookup('rebind.example', { all: true }, (e, a) => resolve([e, a])));
    expect(all).toEqual([null, [{ address: '93.184.216.34', family: 4 }]]);
  });

  it('timeout: richiesta che non risponde entro timeoutMs -> FetchFailedError timeout', async () => {
    state.request = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      });
    await expect(safeFetch('https://slow.example/', { lookup: publicLookup, timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('tronca il corpo a maxBytes e segnala truncated', async () => {
    state.request = async () => response(200, { 'content-type': 'text/html' }, [Buffer.alloc(60, 'a'), Buffer.alloc(60, 'b')]);
    const res = await safeFetch('https://big.example/', { lookup: publicLookup, maxBytes: 100 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(100);
  });

  it('non tronca un corpo entro maxBytes', async () => {
    state.request = async () => response(200, { 'content-type': 'text/html' }, [Buffer.from('ciao')]);
    const res = await safeFetch('https://small.example/', { lookup: publicLookup, maxBytes: 100 });
    expect(res).toMatchObject({ truncated: false, status: 200 });
    expect(res.body.toString()).toBe('ciao');
  });

  it('rifiuta content-length dichiarato oltre il doppio di maxBytes', async () => {
    state.request = async () => response(200, { 'content-length': '1000' }, [Buffer.from('x')]);
    await expect(safeFetch('https://big.example/', { lookup: publicLookup, maxBytes: 100 })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('non invia Accept-Encoding (nessuna decompressione/zip bomb)', async () => {
    let headers: Record<string, string> = {};
    state.request = async (_url, opts) => {
      headers = opts.headers;
      return response(200, { 'content-type': 'text/html' }, [Buffer.from('x')]);
    };
    await safeFetch('https://ok.example/', { lookup: publicLookup, headers: { cookie: 'a=b' } });
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('accept-encoding');
    expect(headers.cookie).toBe('a=b');
  });
});
