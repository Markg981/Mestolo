/** Public support contact (required by the app stores for apps with user content). */
export function supportEmail(): string | null {
  const v = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}
