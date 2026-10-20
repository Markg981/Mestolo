import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import * as v from '../../scripts/mobile-version.mjs';
// @ts-expect-error plain .mjs script without type declarations
import { checkStoreServerUrl } from '../../scripts/mobile-prepare.mjs';

describe('mobile-version', () => {
  it('validates semver and build numbers', () => {
    expect(v.parseVersion('1.0.0')).toBe('1.0.0');
    expect(() => v.parseVersion('1.0')).toThrow();
    expect(v.parseBuildNumber('12')).toBe(12);
    expect(() => v.parseBuildNumber('0')).toThrow();
    expect(() => v.parseBuildNumber('abc')).toThrow();
  });

  it('rewrites gradle versionCode/versionName', () => {
    const src = '  versionCode 1\n  versionName "1.0"\n  other 5';
    expect(v.applyGradleVersion(src, '1.2.3', 9)).toBe('  versionCode 9\n  versionName "1.2.3"\n  other 5');
    expect(() => v.applyGradleVersion('nothing', '1.0.0', 1)).toThrow();
  });

  it('rewrites every pbxproj occurrence and nothing else', () => {
    const src = 'A = 1;\nCURRENT_PROJECT_VERSION = 1;\nMARKETING_VERSION = 1.0;\nX\nCURRENT_PROJECT_VERSION = 3;\nMARKETING_VERSION = 2.0;\nPRODUCT = y;';
    const out = v.applyPbxprojVersion(src, '1.0.0', 5);
    expect(out.match(/CURRENT_PROJECT_VERSION = 5;/g)).toHaveLength(2);
    expect(out.match(/MARKETING_VERSION = 1\.0\.0;/g)).toHaveLength(2);
    expect(out).toContain('A = 1;');
    expect(out).toContain('PRODUCT = y;');
  });
});

describe('checkStoreServerUrl', () => {
  it('rejects placeholder and http URLs', () => {
    expect(checkStoreServerUrl('https://mestolo.example.com')).toMatch(/placeholder/i);
    expect(checkStoreServerUrl('http://192.168.1.2:3000')).toMatch(/HTTPS/);
    expect(checkStoreServerUrl('https://foo.example.org')).toMatch(/placeholder/i);
  });
  it('accepts a real https URL', () => {
    expect(checkStoreServerUrl('https://mestolo.vercel.app')).toBeNull();
  });
});
