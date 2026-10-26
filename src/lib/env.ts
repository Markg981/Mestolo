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
] as const;

/**
 * In production (runtime) missing required variables are an error instead of
 * silently falling back to '' / localhost. Skipped during `next build`, which
 * may run without real secrets; dev/test keep the lenient defaults.
 */
function assertProductionEnv(e: NodeJS.ProcessEnv) {
  if (e.NODE_ENV !== 'production' || e.NEXT_PHASE === 'phase-production-build') return;
  const missing = REQUIRED_IN_PRODUCTION.filter((k) => !e[k]?.trim());
  if (missing.length) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  }
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
