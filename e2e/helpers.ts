import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';

/** Prefisso di tutti gli utenti creati dai test: il teardown cancella quelli che lo hanno. */
export const E2E_PREFIX = 'e2e-';
export const E2E_DOMAIN = 'example.com';

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
    email: `${E2E_PREFIX}${tag}-${id}@${E2E_DOMAIN}`,
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

/** Cancella tutti gli utenti di test (e, a cascata, i loro dati). */
export async function deleteTestUsers(): Promise<number> {
  const admin = adminClient();
  let deleted = 0;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Elenco utenti fallito: ${error.message}`);
    for (const u of data.users) {
      if (u.email?.startsWith(E2E_PREFIX) && u.email.endsWith(`@${E2E_DOMAIN}`)) {
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
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Su desktop il pulsante e' nella barra laterale, su mobile nella pagina "Altro". */
export async function logout(page: Page) {
  const button = page.getByRole('button', { name: 'Esci' });
  if (!(await button.isVisible())) await page.goto('/more');
  await button.click();
  await expect(page).toHaveURL(/\/welcome/);
}
