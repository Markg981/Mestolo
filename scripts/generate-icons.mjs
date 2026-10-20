// Generates PNG icons for the PWA, the app stores and Capacitor from public/icon.svg.
// Usage: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';

const INK = '#2a1a2e';
const svg = readFileSync('public/icon.svg');
// The glyph without the rounded background, for maskable/adaptive icons with a safe zone
const glyph = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M38 10c-3 0-5 2-5 5v16c0 2-1 3-3 3h-1c-6 0-11 5-11 11s5 11 11 11 11-5 11-11V15c0-3-1-5-2-5z" fill="#f5b60a"/><circle cx="29" cy="45" r="5" fill="${INK}"/></svg>`);

mkdirSync('public/icons', { recursive: true });
mkdirSync('assets', { recursive: true });

const square = (size) => sharp(svg, { density: 512 }).resize(size, size).png();
async function padded(size, scale, bg) {
  const inner = Math.round(size * scale);
  const g = await sharp(glyph, { density: 512 }).resize(inner, inner).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } }).composite([{ input: g, gravity: 'center' }]).png();
}

await (await square(192)).toFile('public/icons/icon-192.png');
await (await square(512)).toFile('public/icons/icon-512.png');
await (await padded(512, 0.6, INK)).toFile('public/icons/maskable-512.png');
await (await padded(180, 0.72, INK)).toFile('public/icons/apple-touch-icon.png');
// @capacitor/assets sources
await (await padded(1024, 0.7, INK)).toFile('assets/icon-only.png');
await (await padded(1024, 0.6, { r: 0, g: 0, b: 0, alpha: 0 })).toFile('assets/icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: INK } }).png().toFile('assets/icon-background.png');
for (const [name, bg] of [['splash.png', INK], ['splash-dark.png', INK]]) {
  await (await padded(2732, 0.18, bg)).toFile(`assets/${name}`);
}
console.log('Icons generated.');
