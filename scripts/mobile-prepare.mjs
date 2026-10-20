// Prepares the native projects for the configured server URL before `cap sync`:
//  - mobile/www/config.js (used by the local offline/launch pages)
//  - iOS Info.plist WKAppBoundDomains (required for service workers in WKWebView)
// With MOBILE_STORE_BUILD=1 (release/store builds) a placeholder or non-HTTPS CAP_SERVER_URL is refused.
// Usage: CAP_SERVER_URL=https://your-domain npm run mobile:sync
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  if (/(^|\.)example\.(com|org|net)$/i.test(u.hostname) || u.hostname === 'localhost') {
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

  const server = (process.env.CAP_SERVER_URL ?? 'https://mestolo.example.com').replace(/\/+$/, '');
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
  if (existsSync(plist)) {
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
