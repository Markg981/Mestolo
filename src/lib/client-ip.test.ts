import { describe, expect, it } from 'vitest';
import { extractClientIp, normalizeIpForRateLimit as n } from './client-ip';

describe('normalizeIpForRateLimit', () => {
  it('lascia invariato IPv4', () => expect(n('203.0.113.7')).toBe('203.0.113.7'));
  it('raggruppa IPv6 completo per /64', () => {
    expect(n('2001:0db8:0000:0001:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:0:1::/64');
    expect(n('2001:db8:0:1:1:2:3:4')).toBe(n('2001:db8:0:1:ffff:ffff:ffff:ffff'));
  });
  it('gestisce forma compressa', () => {
    expect(n('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(n('2001:db8:0:1::5')).toBe('2001:db8:0:1::/64');
    expect(n('::1')).toBe('0:0:0:0::/64');
    expect(n('::')).toBe('0:0:0:0::/64');
  });
  it('ignora zone id e maiuscole', () => {
    expect(n('FE80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(n('2001:DB8:0:1::9')).toBe('2001:db8:0:1::/64');
  });
  it('tratta IPv4-mapped come IPv4', () => {
    expect(n('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(n('::FFFF:1.2.3.4')).toBe('1.2.3.4');
  });
  it('non altera input non valido', () => expect(n('unknown')).toBe('unknown'));
});

describe('extractClientIp', () => {
  const h = (v: string) => ({ get: (k: string) => (k === 'x-forwarded-for' ? v : null) });
  it('normalizza IPv6 da x-forwarded-for', () => {
    expect(extractClientIp(h('2001:db8:0:1::a'), {})).toBe('2001:db8:0:1::/64');
    expect(extractClientIp(h('9.9.9.9'), {})).toBe('9.9.9.9');
  });
});
