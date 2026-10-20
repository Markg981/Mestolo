// Captures store screenshots against a running site with a demo account.
// Usage: STORE_BASE_URL=https://... STORE_EMAIL=... STORE_PASSWORD=... npm run store:screenshots
// Optional: STORE_LOCALES=it-IT,en-US  STORE_PLATFORMS=android,ios-69,ios-65  STORE_RECIPE_ID=<uuid>
// Output (gitignored): store/screenshots/<platform>/<locale>/<NN-name>.png
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const baseURL = process.env.STORE_BASE_URL;
const email = process.env.STORE_EMAIL;
const password = process.env.STORE_PASSWORD;
if (!baseURL || !email || !password) {
  console.error('Servono STORE_BASE_URL, STORE_EMAIL e STORE_PASSWORD.');
  process.exit(1);
}

// Final pixel size = css size * deviceScaleFactor.
const PLATFORMS = {
  android: { width: 360, height: 640, scale: 3 }, // 1080x1920
  'ios-69': { width: 440, height: 956, scale: 3 }, // 1320x2868
  'ios-65': { width: 428, height: 926, scale: 3 }, // 1284x2778
};
const LOCALES = (process.env.STORE_LOCALES ?? 'it-IT,en-US').split(',');
const platforms = (process.env.STORE_PLATFORMS ?? Object.keys(PLATFORMS).join(',')).split(',');

// Key screens. Recipe pages are resolved from the first recipe in the list unless STORE_RECIPE_ID is set.
const SCREENS = [
  { name: 'recipes', path: '/recipes' },
  { name: 'recipe', path: (id) => `/recipes/${id}`, needsRecipe: true },
  { name: 'cooking', path: (id) => `/recipes/${id}/cook`, needsRecipe: true },
  { name: 'plan', path: '/plan' },
  { name: 'shopping', path: '/shopping' },
  { name: 'pantry', path: '/pantry' },
  { name: 'discover', path: '/discover' },
];

async function login(page) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

const browser = await chromium.launch();
try {
  for (const locale of LOCALES) {
    for (const key of platforms) {
      const p = PLATFORMS[key];
      if (!p) throw new Error(`Piattaforma sconosciuta: ${key}`);
      const dir = `store/screenshots/${key.startsWith('ios') ? key : 'android'}/${locale}`;
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({
        baseURL,
        locale,
        viewport: { width: p.width, height: p.height },
        deviceScaleFactor: p.scale,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'light',
      });
      const page = await context.newPage();
      await login(page);

      let recipeId = process.env.STORE_RECIPE_ID;
      if (!recipeId) {
        await page.goto('/recipes');
        const href = await page.locator('a[href^="/recipes/"]').evaluateAll(
          (els) => els.map((e) => e.getAttribute('href')).find((h) => /^\/recipes\/[0-9a-f-]{36}$/.test(h ?? '')),
        );
        recipeId = href?.split('/').pop();
      }

      let n = 1;
      for (const s of SCREENS) {
        if (s.needsRecipe && !recipeId) {
          console.warn(`Salto "${s.name}": nessuna ricetta nell'account demo.`);
          continue;
        }
        await page.goto(typeof s.path === 'function' ? s.path(recipeId) : s.path);
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(800);
        const file = `${dir}/${String(n++).padStart(2, '0')}-${s.name}.png`;
        await page.screenshot({ path: file });
        console.log(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
