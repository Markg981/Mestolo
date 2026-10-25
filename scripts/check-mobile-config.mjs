// Fails when tracked native config contains development hosts (localhost, loopback, private IPs).
// Usage: node scripts/check-mobile-config.mjs   (run in CI; see ci.yml and mobile-ios.yml)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDevHost } from './mobile-prepare.mjs';

// Returns the development hosts listed in the WKAppBoundDomains of a plist.
export function findDevHosts(plist) {
  const block = plist.match(/<key>WKAppBoundDomains<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!block) return [];
  return [...block[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1].trim()).filter(isDevHost);
}

function main() {
  const file = 'ios/App/App/Info.plist';
  const bad = findDevHosts(readFileSync(file, 'utf8'));
  if (bad.length) {
    console.error(`${file} contains development hosts in WKAppBoundDomains: ${bad.join(', ')}. Restore it with git checkout.`);
    process.exit(1);
  }
  console.log(`${file}: no development hosts.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
