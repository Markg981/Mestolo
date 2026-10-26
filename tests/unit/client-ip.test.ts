import { describe, expect, it } from 'vitest';
import { extractClientIp } from '@/lib/client-ip';

const hdr = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });

describe('extractClientIp', () => {
  it('su Vercel preferisce x-vercel-forwarded-for', () => {
    expect(extractClientIp(hdr({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }), { VERCEL: '1' })).toBe('1.1.1.1');
  });
  it("su Vercel usa x-real-ip se manca l'altro", () => {
    expect(extractClientIp(hdr({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '9.9.9.9' }), { VERCEL: '1' })).toBe('2.2.2.2');
  });
  it("fuori da Vercel ignora x-real-ip e usa l'ultimo hop di x-forwarded-for", () => {
    expect(extractClientIp(hdr({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '6.6.6.6, 3.3.3.3' }), {})).toBe('3.3.3.3');
  });
  it('fuori da Vercel ignora x-vercel-forwarded-for spoofato dal client', () => {
    expect(extractClientIp(hdr({ 'x-vercel-forwarded-for': '1.2.3.4', 'x-forwarded-for': '6.6.6.6, 3.3.3.3' }), {})).toBe('3.3.3.3');
  });
  it('un IP falsificato in testa non cambia il risultato', () => {
    const a = extractClientIp(hdr({ 'x-forwarded-for': 'fake1, 3.3.3.3' }), {});
    const b = extractClientIp(hdr({ 'x-forwarded-for': 'fake2, 3.3.3.3' }), {});
    expect(a).toBe(b);
  });
  it('rispetta TRUSTED_PROXY_COUNT', () => {
    expect(extractClientIp(hdr({ 'x-forwarded-for': 'fake, 4.4.4.4, 5.5.5.5' }), { TRUSTED_PROXY_COUNT: '2' })).toBe('4.4.4.4');
  });
  it('valori non validi ricadono su 1; catena corta usa il primo hop', () => {
    expect(extractClientIp(hdr({ 'x-forwarded-for': 'a, 7.7.7.7' }), { TRUSTED_PROXY_COUNT: 'x' })).toBe('7.7.7.7');
    expect(extractClientIp(hdr({ 'x-forwarded-for': '7.7.7.7' }), { TRUSTED_PROXY_COUNT: '3' })).toBe('7.7.7.7');
  });
  it('senza header restituisce unknown', () => {
    expect(extractClientIp(hdr({}), {})).toBe('unknown');
  });
});
