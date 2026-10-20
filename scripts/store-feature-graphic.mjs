// Renders the Google Play feature graphic (1024x500) from the brand colors and public/icon.svg.
// Usage: npm run store:graphic  ->  store/android/feature-graphic.png
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';

const INK = '#2a1a2e';
const W = 1024;
const H = 500;
const ICON = 280;

const icon = await sharp(readFileSync('public/icon.svg'), { density: 512 }).resize(ICON, ICON).png().toBuffer();
const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <text x="400" y="255" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="108" font-weight="700" fill="#ffffff">Mestolo</text>
  <text x="404" y="318" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="36" fill="#f5b60a">Il tuo ricettario di tutti i giorni</text>
</svg>`);

mkdirSync('store/android', { recursive: true });
await sharp({ create: { width: W, height: H, channels: 4, background: INK } })
  .composite([
    { input: icon, left: 90, top: Math.round((H - ICON) / 2) },
    { input: text, left: 0, top: 0 },
  ])
  .png()
  .toFile('store/android/feature-graphic.png');
console.log('Feature graphic generated: store/android/feature-graphic.png');
