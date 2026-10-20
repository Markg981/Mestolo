import { createTestUser, deleteTestUsers, randomUser, requireEnv } from './helpers';

/**
 * Crea due utenti di test sul progetto di staging tramite l'API admin:
 * - "main": usato da quasi tutti i test (sessione salvata da auth.setup.ts);
 * - "session": usato dai test di login/logout, che invalidano la sessione.
 * Le credenziali passano ai worker tramite variabili d'ambiente.
 */
export default async function globalSetup() {
  requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  // Pulisce eventuali residui di esecuzioni interrotte
  await deleteTestUsers();

  for (const tag of ['main', 'session'] as const) {
    const user = randomUser(tag);
    await createTestUser(user);
    process.env[`E2E_${tag.toUpperCase()}_EMAIL`] = user.email;
    process.env[`E2E_${tag.toUpperCase()}_PASSWORD`] = user.password;
    process.env[`E2E_${tag.toUpperCase()}_USERNAME`] = user.username;
  }
}
