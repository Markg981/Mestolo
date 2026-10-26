// Prepares the native projects for the configured server URL before `cap sync`:
//  - mobile/www/config.js (used by the local offline/launch pages)
//  - iOS Info.plist WKAppBoundDomains (required for service workers in WKWebView); skipped for development hosts
// CAP_SERVER_URL is required (no default): unset or *.example.com is refused; set CAP_DEV=1 to default to http://localhost:3000.
// With MOBILE_STORE_BUILD=1 (release/store builds) a placeholder or non-HTTPS CAP_SERVER_URL is refused.
// Usage: CAP_SERVER_URL=https://your-domain npm run mobile:sync
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// True for hosts that only make sense on a developer machine (localhost, loopback, private/link-local IPs, .local).
export function isDevHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

// Returns an error message when the URL must not ship in a store build, otherwise null.
export function checkStoreServerUrl(server) {
  let u;
  try {
    u = new URL(server);
  } catch {
    return `CAP_SERVER_URL is not a valid URL: ${server}`;
  }
  if (u.protocol !== 'https:') {
    return `CAP_SERVER_URL (${server}) must be HTTPS for store builds.`;
  }
  if (/(^|\.)example\.(com|org|net)$/i.test(u.hostname) || isDevHost(u.hostname)) {
    return `CAP_SERVER_URL (${server}) is a placeholder: set the real published site URL (e.g. https://mestolo.vercel.app).`;
  }
  return null;
}

function main() {
  for (const f of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(f);
    } catch {
      /* file not present */
    }
  }

  const raw = process.env.CAP_SERVER_URL || (process.env.CAP_DEV === '1' ? 'http://localhost:3000' : '');
  if (!raw) {
    console.error('CAP_SERVER_URL is required: set the published site URL (e.g. https://mestolo.vercel.app), or CAP_DEV=1 for http://localhost:3000.');
    process.exit(1);
  }
  if (/example\.(com|org|net)/i.test(raw)) {
    console.error(`CAP_SERVER_URL (${raw}) is a placeholder: set the real published site URL.`);
    process.exit(1);
  }
  const server = raw.replace(/\/+$/, '');
  let url;
  try {
    url = new URL(server);
  } catch {
    console.error(`Invalid CAP_SERVER_URL: ${server}`);
    process.exit(1);
  }
  if (process.env.MOBILE_STORE_BUILD === '1') {
    const problem = checkStoreServerUrl(server);
    if (problem) {
      console.error(`Store build refused: ${problem}`);
      process.exit(1);
    }
  }
  if (url.protocol !== 'https:' && process.env.CAP_ALLOW_HTTP !== '1') {
    console.warn(`! ${server} is not HTTPS: fine for device tests on your network, NOT for store builds.`);
  }
  writeFileSync('mobile/www/config.js', `window.MESTOLO_SERVER = ${JSON.stringify(server)};\n`);

  const plist = 'ios/App/App/Info.plist';
  if (isDevHost(url.hostname)) {
    // Info.plist is tracked: never write development hosts into it (it would end up committed/published).
    console.warn(`! ${url.hostname} is a development host: ios/App/App/Info.plist (WKAppBoundDomains) left untouched.`);
  } else if (existsSync(plist)) {
    let s = readFileSync(plist, 'utf8');
    const block = `<key>WKAppBoundDomains</key>\n\t<array>\n\t\t<string>${url.hostname}</string>\n\t</array>`;
    if (s.includes('<key>WKAppBoundDomains</key>')) {
      s = s.replace(/<key>WKAppBoundDomains<\/key>\s*<array>[\s\S]*?<\/array>/, block);
    } else {
      s = s.replace(/<dict>/, `<dict>\n\t${block}`);
    }
    writeFileSync(plist, s);
  }
  console.log(`Mobile shell configured for ${server}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
