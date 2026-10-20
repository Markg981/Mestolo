import { deleteTestUsers } from './helpers';

/** Cancella gli utenti di test (profili, ricette, lista della spesa e piano vanno via a cascata). */
export default async function globalTeardown() {
  const n = await deleteTestUsers();
  console.log(`E2E: cancellati ${n} utenti di test`);
}
