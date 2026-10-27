import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**', 'android/**', 'ios/**', 'assets/**', 'mobile/www/**', 'public/sw.js', 'public/ocr/**', '.claude/**', '**/.idea/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/run-action.ts'],
    rules: {
      // Un errore di rete dentro una transizione finirebbe nell'error boundary: usare useActionTransition (src/lib/run-action.ts).
      'no-restricted-imports': ['error', { paths: [{ name: 'react', importNames: ['useTransition'], message: "Usa useActionTransition da @/lib/run-action: start(async ...) senza catch manda gli errori di rete all'error boundary." }] }],
    },
  },
  {
    rules: {
      '@next/next/no-img-element': 'off', // images are served by our auth-checked route, not the optimizer
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

export default config;
