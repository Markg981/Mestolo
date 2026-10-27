import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';

/** Prefisso di tutti gli utenti creati dai test: il teardown cancella quelli che lo hanno. */
export const E2E_PREFIX = 'e2e-';
export const E2E_DOMAIN = 'example.com';
/** Oltre questa eta' un utente di test e' un residuo di un'esecuzione interrotta. */
const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Identificativo dell'esecuzione corrente, impostato da global-setup e ereditato dai worker.
 * Piu' esecuzioni (PR diverse) girano in parallelo sullo stesso staging: ognuna cancella
 * solo i propri utenti, mai quelli delle altre.
 */
export function runId(): string {
  if (!process.env.E2E_RUN_ID) process.env.E2E_RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return process.env.E2E_RUN_ID;
}

function runPrefix(): string {
  return `${E2E_PREFIX}${runId()}-`;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return v;
}

export function adminClient(): SupabaseClient {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestUser {
  email: string;
  password: string;
  username: string;
}

export function randomUser(tag: string): TestUser {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    email: `${runPrefix()}${tag}-${id}@${E2E_DOMAIN}`,
    password: `Pw-${id}-Test1!`,
    username: `${E2E_PREFIX.replace('-', '_')}${tag}_${id}`.slice(0, 24),
  };
}

/** Crea un utente gia' confermato con l'API admin (il trigger crea il profilo dai metadati). */
export async function createTestUser(user: TestUser): Promise<string> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username, locale: 'it' },
  });
  if (error || !data.user) throw new Error(`Creazione utente di test fallita: ${error?.message}`);
  return data.user.id;
}

/**
 * Cancella gli utenti di test (e, a cascata, i loro dati): quelli dell'esecuzione corrente
 * se `ownRun`, e in ogni caso i residui piu' vecchi di STALE_MS lasciati da altre esecuzioni.
 */
export async function deleteTestUsers({ ownRun }: { ownRun: boolean }): Promise<number> {
  const admin = adminClient();
  let deleted = 0;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Elenco utenti fallito: ${error.message}`);
    for (const u of data.users) {
      if (!u.email?.startsWith(E2E_PREFIX) || !u.email.endsWith(`@${E2E_DOMAIN}`)) continue;
      const stale = Date.now() - new Date(u.created_at).getTime() > STALE_MS;
      if (stale || (ownRun && u.email.startsWith(runPrefix()))) {
        const { error: delError } = await admin.auth.admin.deleteUser(u.id);
        if (delError) console.warn(`Impossibile cancellare ${u.email}: ${delError.message}`);
        else deleted++;
      }
    }
    if (data.users.length < 200) break;
  }
  return deleted;
}

export async function login(page: Page, user: TestUser) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  // Il limite login_ip (20 / 15 min) e' per IP: in CI tutti i login partono da 127.0.0.1 e lo esauriscono.
  // L'header vale solo per questo invio (stessa origine) e viene rimosso subito dopo, per non far partire
  // preflight CORS verso Supabase.
  const fakeIp = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': fakeIp });
  try {
    await page.getByRole('button', { name: 'Accedi' }).click();
    await expect(page).not.toHaveURL(/\/login/);
  } finally {
    await page.context().setExtraHTTPHeaders({});
  }
}

/** Su desktop il pulsante e' nella barra laterale, su mobile nella pagina "Altro". */
export async function logout(page: Page) {
  const button = page.getByRole('button', { name: 'Esci' });
  if (!(await button.isVisible())) await page.goto('/more');
  await button.click();
  await expect(page).toHaveURL(/\/welcome/);
}

/**
 * Crea un utente nuovo e lo fa accedere in un contesto separato (sessione vuota): per i flussi
 * con piu' utenti. Il contesto non eredita le opzioni del progetto, quindi baseURL e locale
 * vanno passati qui.
 */
export async function newUserPage(browser: Browser, testInfo: TestInfo, tag: string) {
  const user = randomUser(tag);
  const id = await createTestUser(user);
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: 'it-IT',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await login(page, user);
  return { user, id, page, close: () => context.close() };
}

/** Ricetta creata direttamente con il service role, per preparare i flussi che non la creano. */
export async function createTestRecipe(ownerId: string, title: string, visibility: 'private' | 'friends' | 'public') {
  const { data, error } = await adminClient()
    .from('recipes')
    .insert({ owner_id: ownerId, title, visibility, ingredients: [{ name: 'farina', quantity: 100, unit: 'g' }] })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Creazione ricetta di test fallita: ${error?.message}`);
  return data.id as string;
}
