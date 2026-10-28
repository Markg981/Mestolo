import 'server-only';

/** Server-side configuration. Read lazily so that builds work without secrets. */
export function env() {
  const e = process.env;
  assertProductionEnv(e);
  return {
    supabaseUrl: e.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY ?? '',
    siteUrl: (e.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    encryptionKey: e.APP_ENCRYPTION_KEY,
    encryptionKeyPrevious: e.APP_ENCRYPTION_KEY_PREVIOUS,
    ai: {
      appProvider: (e.AI_APP_PROVIDER ?? '').trim() as '' | 'anthropic' | 'openai' | 'openai-compatible',
      appApiKey: e.AI_APP_API_KEY ?? '',
      appBaseUrl: e.AI_APP_BASE_URL ?? '',
      appTextModel: e.AI_APP_TEXT_MODEL ?? '',
      appVisionModel: e.AI_APP_VISION_MODEL ?? '',
      appImageEnabled: e.AI_APP_IMAGE_ENABLED === 'true',
      appImageModel: e.AI_APP_IMAGE_MODEL ?? '',
      limits: {
        text: intOr(e.AI_DAILY_LIMIT_TEXT, 20),
        vision: intOr(e.AI_DAILY_LIMIT_VISION, 10),
        image: intOr(e.AI_DAILY_LIMIT_IMAGE, 2),
        translate: intOr(e.AI_DAILY_LIMIT_TRANSLATE, 30),
      },
      transcribeModel: e.AI_TRANSCRIBE_MODEL || 'whisper-1',
      userAnthropicModel: e.AI_USER_ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      userOpenaiTextModel: e.AI_USER_OPENAI_TEXT_MODEL || 'gpt-5-mini',
      userOpenaiImageModel: e.AI_USER_OPENAI_IMAGE_MODEL || 'gpt-image-1',
    },
  };
}

const REQUIRED_IN_PRODUCTION = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'APP_ENCRYPTION_KEY',
] as const;

const CRON_SECRET_MIN_LENGTH = 16;

/**
 * In production (runtime) missing required variables are an error instead of
 * silently falling back to '' / localhost. Skipped during `next build`, which
 * may run without real secrets; dev/test keep the lenient defaults.
 */
export function assertProductionEnv(e: NodeJS.ProcessEnv) {
  if (e.NODE_ENV !== 'production' || e.NEXT_PHASE === 'phase-production-build') return;
  const missing = REQUIRED_IN_PRODUCTION.filter((k) => !e[k]?.trim());
  if (missing.length) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  }
  // APP_ENCRYPTION_KEY: base64 di 32 byte (come generato da `npm run gen:key` e decodificato in crypto/secrets).
  if (Buffer.from(e.APP_ENCRYPTION_KEY!.trim(), 'base64').length !== 32) {
    throw new ConfigError('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
  }
  const prev = e.APP_ENCRYPTION_KEY_PREVIOUS?.trim();
  if (prev && Buffer.from(prev, 'base64').length !== 32) {
    throw new ConfigError('APP_ENCRYPTION_KEY_PREVIOUS must be 32 bytes (base64)');
  }
}

/**
 * Fail-fast all'avvio (instrumentation.register) in produzione: vercel.json pianifica
 * sempre i cron, quindi CRON_SECRET mancante o corto farebbe rispondere 401 in silenzio.
 * Separata da assertProductionEnv: il login e il resto dell'app non dipendono da env()
 * per CRON_SECRET. Nei messaggi mai il valore, solo la lunghezza minima.
 */
export function assertCronSecret(e: NodeJS.ProcessEnv) {
  if (e.NODE_ENV !== 'production' || e.NEXT_PHASE === 'phase-production-build') return;
  const secret = e.CRON_SECRET;
  if (!secret?.trim()) {
    throw new ConfigError('Missing required environment variable: CRON_SECRET (min 16 characters, e.g. `openssl rand -hex 32`)');
  }
  if (secret.length < CRON_SECRET_MIN_LENGTH) {
    throw new ConfigError(`CRON_SECRET must be at least ${CRON_SECRET_MIN_LENGTH} characters`);
  }
}

/**
 * Secret delle route cron, validato solo dove serve (non in env(): il login e il
 * resto dell'app non devono dipendere da CRON_SECRET; in produzione assertCronSecret
 * lo impone all'avvio). Restituisce null se manca
 * o, in produzione, e' piu' corto del minimo: le route cron rispondono 401 (fail-closed).
 */
export function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  if (process.env.NODE_ENV === 'production' && secret.length < CRON_SECRET_MIN_LENGTH) return null;
  return secret;
}

function intOr(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
}

export function isSupabaseConfigured(): boolean {
  // Reads process.env directly: must not throw, the setup page relies on it.
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export class ConfigError extends Error {}
