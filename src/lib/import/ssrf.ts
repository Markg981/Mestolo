import ipaddr from 'ipaddr.js';

/**
 * SSRF protections for fetching user-supplied URLs.
 * Only globally routable unicast addresses are allowed; everything else
 * (loopback, private, link-local, CGNAT, multicast, reserved, IPv4-mapped
 * private addresses, NAT64/6to4/Teredo encodings, cloud metadata) is blocked.
 */
export function isPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  const range = addr.range();
  return range === 'unicast';
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.intranet', '.corp', '.home.arpa'];

export class UnsafeUrlError extends Error {
  constructor(public code: 'invalid_url' | 'protocol' | 'credentials' | 'port' | 'host' | 'private_address' | 'dns' | 'too_many_redirects') {
    super(code);
  }
}

/** Static validation of a URL before any network activity. */
export function validateExternalUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length > 2000) throw new UnsafeUrlError('invalid_url');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('protocol');
  if (url.username || url.password) throw new UnsafeUrlError('credentials');
  if (url.port && url.port !== '80' && url.port !== '443') throw new UnsafeUrlError('port');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || !host.includes('.') && !ipaddr.isValid(host)) throw new UnsafeUrlError('host');
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new UnsafeUrlError('host');
  if (ipaddr.isValid(host) && !isPublicIp(host)) throw new UnsafeUrlError('private_address');
  // Numeric host forms that some resolvers interpret as IPs (e.g. "2130706433", "0x7f.1")
  if (/^[0-9.]+$/.test(host) && !ipaddr.IPv4.isValidFourPartDecimal(host)) throw new UnsafeUrlError('host');
  if (/^0x/i.test(host)) throw new UnsafeUrlError('host');
  url.hash = '';
  return url;
}

export type LookupAddress = { address: string; family: number };
export type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

/** Resolves a hostname and rejects it if ANY resolved address is not public. */
export async function resolvePublicAddresses(hostname: string, lookup: LookupFn): Promise<LookupAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host)) {
    if (!isPublicIp(host)) throw new UnsafeUrlError('private_address');
    return [{ address: host, family: host.includes(':') ? 6 : 4 }];
  }
  let addrs: LookupAddress[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new UnsafeUrlError('dns');
  }
  if (!addrs.length) throw new UnsafeUrlError('dns');
  if (addrs.some((a) => !isPublicIp(a.address))) throw new UnsafeUrlError('private_address');
  return addrs;
}
