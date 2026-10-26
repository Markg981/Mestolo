import { describe, expect, it } from 'vitest';
import { parseOtpType } from './auth-otp';

describe('parseOtpType', () => {
  it.each(['signup', 'recovery', 'email_change', 'email'])('accepts %s', (t) => {
    expect(parseOtpType(t)).toBe(t);
  });
  it.each(['invite', 'magiclink', 'sms', '', 'SIGNUP', null, undefined, 42])('rejects %s', (t) => {
    expect(parseOtpType(t)).toBeNull();
  });
});
