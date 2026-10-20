// Prepares the native projects for the configured server URL before `cap sync`:
//  - mobile/www/config.js (used by the local offline/launch pages)
//  - iOS Info.plist WKAppBoundDomains (required for service workers in WKWebView)
// Usage: CAP_SERVER_URL=https://your-domain npm run mobile:sync
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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
