import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from './push-endpoint';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://android.googleapis.com/gcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accetta %s', (u) => expect(isAllowedPushEndpoint(u)).toBe(true));

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'https://example.com/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://evil.com/fcm.googleapis.com',
    'https://fcm.googleapis.com@evil.com/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://push.apple.com/x',
    'https://evilpush.apple.com.evil.com/x',
    'not a url',
    '',
  ])('rifiuta %s', (u) => expect(isAllowedPushEndpoint(u)).toBe(false));

  it('rifiuta valori non stringa o troppo lunghi', () => {
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
    expect(isAllowedPushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(2048)}`)).toBe(false);
  });
});
