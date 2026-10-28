import { adminClient, createTestUser, deleteTestUsers, randomUser, requireEnv, runId } from './helpers';

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

  // Pulisce i residui di esecuzioni interrotte, non gli utenti di quelle ancora in corso
  runId();
  await deleteTestUsers({ ownRun: false });

  // In CI l'IP del client e' sempre "unknown": senza azzerarli, i limiti di
  // registrazione/accesso per IP si esauriscono dopo poche esecuzioni all'ora.
  const { error } = await adminClient()
    .from('rate_limit_events')
    .delete()
    .or('bucket.like.signup_ip:*,bucket.like.login_ip:*,bucket.like.reset_ip:*,bucket.like.reset_email:*');
  if (error) throw new Error(`Pulizia rate limit fallita: ${error.message}`);

  for (const tag of ['main', 'session'] as const) {
    const user = randomUser(tag);
    await createTestUser(user);
    process.env[`E2E_${tag.toUpperCase()}_EMAIL`] = user.email;
    process.env[`E2E_${tag.toUpperCase()}_PASSWORD`] = user.password;
    process.env[`E2E_${tag.toUpperCase()}_USERNAME`] = user.username;
  }
}
