import { expect, test, type Page } from '@playwright/test';
import { requireServiceWorker } from './helpers-extra';

// Promemoria pasti (NotificationSettings nella pagina Impostazioni). Nessun push service reale:
// PushManager viene simulato nel browser e il permesso e concesso con context.grantPermissions.
// Con push web supportato servono NEXT_PUBLIC_VAPID_PUBLIC_KEY e un service worker (build di produzione).

test.describe.configure({ mode: 'serial' });

const FAKE_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-fake-endpoint';

/** Sostituisce subscribe/getSubscription di PushManager con una sottoscrizione finta in memoria. */
async function fakePushManager(page: Page) {
  await page.addInitScript((endpoint) => {
    const w = window as unknown as { __fakeSub: unknown; __unsubscribed: number };
    w.__fakeSub = null;
    w.__unsubscribed = 0;
    const make = () => ({
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: 'BP'.padEnd(87, 'a'), auth: 'e2e-auth-secret-aaaaaa'.slice(0, 22) } }),
      unsubscribe: async () => {
        w.__fakeSub = null;
        w.__unsubscribed++;
        return true;
      },
    });
    if (typeof PushManager !== 'undefined') {
      PushManager.prototype.getSubscription = async () => w.__fakeSub as PushSubscription | null;
      PushManager.prototype.subscribe = async () => (w.__fakeSub = make()) as unknown as PushSubscription;
    }
  }, FAKE_ENDPOINT);
}

/** La pagina ha piu form con "Salva": si prende quello che contiene il commutatore dei promemoria. */
function saveButton(page: Page) {
  return page
    .locator('form')
    .filter({ has: page.getByRole('checkbox', { name: /Attiva i promemoria/ }) })
    .getByRole('button', { name: 'Salva', exact: true });
}

test.describe('notifiche promemoria pasti', () => {
  test('la sezione impostazioni mostra il commutatore o l\'avviso di non supportato', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Promemoria dei pasti' })).toBeVisible();
    const toggle = page.getByRole('checkbox', { name: /Attiva i promemoria/ });
    await expect(toggle).toBeVisible();
    // Senza chiave VAPID o senza Push API il commutatore e disabilitato e compare l'avviso
    const unsupported = page.getByText('Questo browser non supporta le notifiche push.', { exact: false });
    if (await toggle.isDisabled()) await expect(unsupported).toBeVisible();
    else await expect(unsupported).toHaveCount(0);
  });

  test('gli orari sono modificabili solo con i promemoria attivi', async ({ page }) => {
    await page.goto('/settings');
    const toggle = page.getByRole('checkbox', { name: /Attiva i promemoria/ });
    // Prima dell'idratazione il commutatore e' abilitato: il rilevamento del supporto push avviene dopo.
    await page.waitForLoadState('networkidle');
    test.skip(await toggle.isDisabled(), 'push web non supportato in questo ambiente (manca NEXT_PUBLIC_VAPID_PUBLIC_KEY?)');
    const lunch = page.getByLabel('Pranzo', { exact: true });
    if (await toggle.isChecked()) await toggle.uncheck();
    await expect(lunch).toBeDisabled();
    await toggle.check();
    await expect(lunch).toBeEnabled();
  });

  test('con il permesso concesso salva le preferenze e registra la sottoscrizione push', async ({ page, context }) => {
    await context.grantPermissions(['notifications']);
    await fakePushManager(page);
    await page.goto('/settings');
    await requireServiceWorker(page);
    const toggle = page.getByRole('checkbox', { name: /Attiva i promemoria/ });
    // Prima dell'idratazione il commutatore e' abilitato: il rilevamento del supporto push avviene dopo.
    await page.waitForLoadState('networkidle');
    test.skip(await toggle.isDisabled(), 'push web non supportato in questo ambiente (manca NEXT_PUBLIC_VAPID_PUBLIC_KEY?)');

    if (!(await toggle.isChecked())) await toggle.check();
    await page.getByLabel('Pranzo', { exact: true }).fill('12:30');
    await saveButton(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Preferenze salvate.' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __fakeSub: unknown }).__fakeSub !== null)).toBe(true);

    // Le preferenze persistono
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /Attiva i promemoria/ })).toBeChecked();
    await expect(page.getByLabel('Pranzo', { exact: true })).toHaveValue('12:30');

    // Disattivando si annulla la sottoscrizione del browser
    await fakePushManager(page);
    await page.getByRole('checkbox', { name: /Attiva i promemoria/ }).uncheck();
    await saveButton(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Preferenze salvate.' })).toBeVisible();
  });

  test('con il permesso negato mostra il messaggio e non salva', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' });
    });
    await page.goto('/settings');
    await requireServiceWorker(page);
    const toggle = page.getByRole('checkbox', { name: /Attiva i promemoria/ });
    // Prima dell'idratazione il commutatore e' abilitato: il rilevamento del supporto push avviene dopo.
    await page.waitForLoadState('networkidle');
    test.skip(await toggle.isDisabled(), 'push web non supportato in questo ambiente (manca NEXT_PUBLIC_VAPID_PUBLIC_KEY?)');

    if (!(await toggle.isChecked())) await toggle.check();
    await saveButton(page).click();
    await expect(page.getByText('Notifiche non consentite', { exact: false })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Preferenze salvate.' })).toHaveCount(0);
  });
});
