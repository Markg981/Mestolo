import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@formatjs/icu-messageformat-parser';
import { LOCALES, matchAcceptLanguage } from '@/i18n/config';

type Tree = { [k: string]: string | Tree };

function flatten(obj: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const root = join(__dirname, '..', '..');
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, flatten(JSON.parse(readFileSync(join(root, 'messages', `${l}.json`), 'utf8')))]),
) as Record<(typeof LOCALES)[number], Record<string, string>>;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mts)$/.test(f) ? [p] : [];
  });
}

/**
 * Static scan: finds `const t = useTranslations('ns')`, `await getTranslations('ns')` and
 * `const [t, ...] = await Promise.all([getTranslations('ns'), ...])`, then every literal
 * call `t('key')` on that variable, and checks that `ns.key` exists.
 * Dynamic keys (t(`categories.${slug}`)) are verified by dedicated lists below.
 */
function usedKeys(): { file: string; key: string }[] {
  const out: { file: string; key: string }[] = [];
  const declRe =
    /const\s+(?:(\w+)|\[\s*(\w+)[^\]]*\])\s*=\s*(?:await\s+)?(?:Promise\.all\(\[\s*)?(?:useTranslations|getTranslations)\(\s*(?:'([\w.]*)'|"([\w.]*)")?\s*\)/g;
  for (const file of walk(join(root, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const decls = [...src.matchAll(declRe)].map((m) => ({ v: m[1] ?? m[2], ns: m[3] ?? m[4] ?? '', start: m.index ?? 0 }));
    decls.forEach((d, i) => {
      // a declaration is in scope until the next declaration of the same variable
      const next = decls.slice(i + 1).find((x) => x.v === d.v);
      const seg = src.slice(d.start, next ? next.start : src.length);
      for (const c of seg.matchAll(new RegExp(`\\b${d.v}(?:\\.rich|\\.markup|\\.has)?\\(\\s*'([\\w.]+)'`, 'g'))) {
        out.push({ file: file.replace(root, ''), key: d.ns ? `${d.ns}.${c[1]}` : c[1] });
      }
    });
  }
  return out;
}

describe('i18n', () => {
  it('every locale has exactly the same keys as Italian', () => {
    const base = Object.keys(messages.it).sort();
    for (const l of LOCALES) {
      const keys = Object.keys(messages[l]).sort();
      const missing = base.filter((k) => !(k in messages[l]));
      const extra = keys.filter((k) => !(k in messages.it));
      expect({ locale: l, missing, extra }).toEqual({ locale: l, missing: [], extra: [] });
    }
  });

  it('no empty translations', () => {
    for (const l of LOCALES) {
      const empty = Object.entries(messages[l]).filter(([, v]) => !v.trim()).map(([k]) => k);
      expect({ l, empty }).toEqual({ l, empty: [] });
    }
  });

  it('ICU syntax is valid and arguments/plurals/tags match across locales', () => {
    // Uses the same ICU parser as next-intl, so plural branch text is not mistaken for an argument.
    type El = { type: number; value?: string; options?: Record<string, { value: El[] }>; children?: El[] };
    const signature = (src: string): string => {
      const out: string[] = [];
      const walkEls = (els: El[]) => {
        for (const e of els) {
          if ([1, 2, 3, 4].includes(e.type)) out.push(`arg:${e.value}`);
          if (e.type === 5 || e.type === 6) {
            out.push(`${e.type === 6 ? 'plural' : 'select'}:${e.value}`);
            for (const o of Object.values(e.options ?? {})) walkEls(o.value);
          }
          if (e.type === 8) {
            out.push(`tag:${e.value}`);
            walkEls(e.children ?? []);
          }
        }
      };
      walkEls(parse(src) as El[]);
      return [...new Set(out)].sort().join(',');
    };
    for (const [k, v] of Object.entries(messages.it)) {
      const expected = signature(v);
      for (const l of LOCALES) {
        let got: string;
        try {
          got = signature(messages[l][k] ?? '');
        } catch {
          got = 'INVALID_ICU';
        }
        expect({ k, l, sig: got }).toEqual({ k, l, sig: expected });
      }
    }
  });

  it('every key used in the source exists', () => {
    const missing = usedKeys().filter(({ key }) => !(key in messages.it));
    expect(missing).toEqual([]);
  });

  it('dynamic key families are complete', async () => {
    const { SYSTEM_CATEGORY_SLUGS } = await import('@/lib/recipes/categories');
    const { UNIT_KEYS } = await import('@/lib/recipes/units');
    const families = [
      ...SYSTEM_CATEGORY_SLUGS.map((s) => `categories.${s}`),
      ...UNIT_KEYS.map((u) => `units.${u}`),
      ...['private', 'friends', 'public'].map((v) => `visibility.${v}`),
      ...['private', 'friends', 'public'].map((v) => `visibility.${v}Hint`),
      ...['missing', 'low_confidence', 'ambiguous', 'ai_estimate'].map((f) => `flags.${f}`),
      ...['missing_page', 'ambiguous_text', 'unreadable', 'low_confidence', 'no_structured_data', 'partial_content', 'paywall_or_js', 'no_ingredients', 'no_steps'].map((w) => `warnings.${w}`),
      ...['breakfast', 'lunch', 'dinner', 'snack'].map((s) => `plan.slots.${s}`),
      ...['create', 'edit', 'import', 'ai_suggestions', 'restore', 'copy'].map((s) => `history.source.${s}`),
      ...['spam', 'offensive', 'copyright', 'unsafe', 'other'].map((r) => `report.reasons.${r}`),
      ...['vegetarian', 'vegan', 'pescatarian', 'no_pork', 'no_alcohol'].map((d) => `settings.diets.${d}`),
      ...['same_source', 'similar_title', 'similar_content'].map((d) => `editor.duplicateReason.${d}`),
      ...['step_rewrite', 'ingredient_fix', 'ingredient_add', 'time_estimate', 'idea'].map((d) => `assistant.types.${d}`),
      ...['text', 'vision', 'image', 'translate'].map((c) => `aiSettings.capability.${c}`),
      ...['manual', 'photo', 'url', 'text', 'copy', 'variant'].map((s) => `recipe.sourceType.${s}`),
      ...['conduct', 'content', 'rights', 'safety', 'moderation', 'account'].flatMap((s) => [`terms.${s}`, `terms.${s}Title`]),
      ...['data', 'visibility', 'photos', 'ai', 'keys', 'images', 'export', 'logs'].flatMap((s) => [`privacy.${s}`, `privacy.${s}Title`]),
    ];
    const errorCodes = readFileSync(join(root, 'src/app/actions/_utils.ts'), 'utf8').match(/export type ErrorCode =([\s\S]*?);/)![1];
    for (const code of errorCodes.matchAll(/'(\w+)'/g)) families.push(`errors.${code[1]}`);
    expect(families.filter((k) => !(k in messages.it))).toEqual([]);
  });

  it('negotiates the interface language', () => {
    expect(matchAcceptLanguage('de-DE,de;q=0.9,en;q=0.8')).toBe('de');
    expect(matchAcceptLanguage('ja,zh;q=0.9')).toBe('it');
    expect(matchAcceptLanguage('pt-BR;q=0.5,fr;q=0.9')).toBe('fr');
    expect(matchAcceptLanguage(null)).toBe('it');
  });
});
