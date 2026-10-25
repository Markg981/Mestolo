import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**', 'android/**', 'ios/**', 'assets/**', 'mobile/www/**', 'public/sw.js', 'public/ocr/**', '.claude/**', '**/.idea/**'],
  },
  {
    rules: {
      '@next/next/no-img-element': 'off', // images are served by our auth-checked route, not the optimizer
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

export default config;
