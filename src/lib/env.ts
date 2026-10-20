import 'server-only';

/** Server-side configuration. Read lazily so that builds work without secrets. */
export function env() {
  const e = process.env;
  return {
    supabaseUrl: e.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY ?? '',
    siteUrl: (e.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    encryptionKey: e.APP_ENCRYPTION_KEY,
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

function intOr(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
}

export function isSupabaseConfigured(): boolean {
  const c = env();
  return !!(c.supabaseUrl && c.supabaseAnonKey);
}

export class ConfigError extends Error {}
