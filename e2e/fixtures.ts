import type { TestUser } from './helpers';

export function envUser(tag: 'main' | 'session'): TestUser {
  const key = tag.toUpperCase();
  return {
    email: process.env[`E2E_${key}_EMAIL`] ?? '',
    password: process.env[`E2E_${key}_PASSWORD`] ?? '',
    username: process.env[`E2E_${key}_USERNAME`] ?? '',
  };
}
