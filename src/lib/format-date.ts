/** Formats an ISO timestamp as a medium date in UTC, so server and client render the same day. */
export function formatDateUtc(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
}
