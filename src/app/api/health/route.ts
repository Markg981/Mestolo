import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 3000;
const HEADERS = { 'Cache-Control': 'no-store' };

async function checkConfig(): Promise<boolean> {
  try {
    const e = env(); // lancia ConfigError se manca la configurazione obbligatoria in produzione
    return Boolean(e.supabaseUrl && e.serviceRoleKey);
  } catch (err) {
    console.error('[health] config check failed', err);
    return false;
  }
}

async function checkDb(): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = createAdminClient()
      .from('profiles')
      .select('id', { head: true })
      .limit(1)
      .abortSignal(controller.signal);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('db ping timeout'));
      }, DB_TIMEOUT_MS);
    });
    const { error } = await Promise.race([query, timeout]);
    if (error) {
      console.error('[health] db check failed', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[health] db check failed', err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Health check pubblico per monitor esterni: nessun dettaglio negli esiti, solo log lato server. */
export async function GET() {
  const config = await checkConfig();
  const db = config ? await checkDb() : false;
  if (config && db) return NextResponse.json({ status: 'ok' }, { headers: HEADERS });
  return NextResponse.json({ status: 'error', checks: { config, db } }, { status: 503, headers: HEADERS });
}
