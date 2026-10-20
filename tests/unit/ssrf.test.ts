import { describe, expect, it } from 'vitest';
import { isPublicIp, resolvePublicAddresses, validateExternalUrl, UnsafeUrlError } from '@/lib/import/ssrf';
import { safeFetch } from '@/lib/import/safe-fetch';

describe('isPublicIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:a00:1::',
  ])('blocks %s', (ip) => expect(isPublicIp(ip)).toBe(false));
  it.each(['8.8.8.8', '151.101.1.69', '2a00:1450:4001:80b::200e'])('allows %s', (ip) => expect(isPublicIp(ip)).toBe(true));
});

describe('validateExternalUrl', () => {
  it.each([
    ['ftp://example.com/x', 'protocol'],
    ['file:///etc/passwd', 'protocol'],
    ['javascript:alert(1)', 'protocol'],
    ['http://user:pass@example.com', 'credentials'],
    ['http://example.com:8080/', 'port'],
    ['http://localhost/', 'host'],
    ['http://printer.local/', 'host'],
    ['http://intranet/', 'host'],
    ['http://127.0.0.1/', 'private_address'],
    ['http://[::1]/', 'private_address'],
    ['http://169.254.169.254/latest/meta-data', 'private_address'],
    // WHATWG URL parsing normalises these to 127.0.0.1, which is then blocked
    ['http://2130706433/', 'private_address'],
    ['http://0x7f000001/', 'private_address'],
    ['not a url', 'invalid_url'],
  ])('rejects %s (%s)', (url, code) => {
    try {
      validateExternalUrl(url);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeUrlError);
      expect((e as UnsafeUrlError).code).toBe(code);
    }
  });
  it('accepts normal https URLs and strips the fragment', () => {
    expect(validateExternalUrl('https://www.example.com/ricetta?id=1#top').toString()).toBe('https://www.example.com/ricetta?id=1');
  });
});

describe('DNS validation (mocked resolver)', () => {
  it('rejects hostnames resolving to private addresses (any of them)', async () => {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }];
    await expect(resolvePublicAddresses('evil.example', lookup)).rejects.toMatchObject({ code: 'private_address' });
  });
  it('accepts hostnames resolving only to public addresses', async () => {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    await expect(resolvePublicAddresses('ok.example', lookup)).resolves.toHaveLength(1);
  });
  it('maps resolver failures to a dns error', async () => {
    const lookup = async () => { throw new Error('ENOTFOUND'); };
    await expect(resolvePublicAddresses('nx.example', lookup)).rejects.toMatchObject({ code: 'dns' });
  });
  it('safeFetch refuses to connect when DNS points to a private network', async () => {
    const lookup = async () => [{ address: '192.168.0.10', family: 4 }];
    await expect(safeFetch('https://rebind.example/recipe', { lookup })).rejects.toMatchObject({ code: 'private_address' });
  });
  it('safeFetch refuses literal private IPs before any network activity', async () => {
    await expect(safeFetch('http://127.0.0.1/')).rejects.toMatchObject({ code: 'private_address' });
  });
});
