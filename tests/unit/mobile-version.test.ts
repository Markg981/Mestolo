import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import * as v from '../../scripts/mobile-version.mjs';
// @ts-expect-error plain .mjs script without type declarations
import { checkStoreServerUrl, isDevHost } from '../../scripts/mobile-prepare.mjs';

// @ts-expect-error plain .mjs script without type declarations
import { findDevHosts } from '../../scripts/check-mobile-config.mjs';

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

describe('development hosts', () => {
  it('detects localhost, loopback and private IPs only', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.2', '172.20.1.1', 'pc.local', '[::1]']) expect(isDevHost(h)).toBe(true);
    for (const h of ['mestolo.vercel.app', '8.8.8.8', '172.32.0.1']) expect(isDevHost(h)).toBe(false);
  });
  it('refuses a development host in store builds', () => {
    expect(checkStoreServerUrl('https://192.168.1.2')).toMatch(/placeholder/i);
  });
  it('finds development hosts in the plist WKAppBoundDomains', () => {
    const plist = (h: string) => `<dict>\n\t<key>WKAppBoundDomains</key>\n\t<array>\n\t\t<string>${h}</string>\n\t</array>\n</dict>`;
    expect(findDevHosts(plist('localhost'))).toEqual(['localhost']);
    expect(findDevHosts(plist('mestolo.vercel.app'))).toEqual([]);
  });
});
