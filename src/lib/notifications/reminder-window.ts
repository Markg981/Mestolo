export const REMINDER_WINDOW_DEFAULT_MINUTES = 45;
/** Oltre un'ora un promemoria del pasto e' solo rumore: l'app limita la finestra a 60 minuti (la funzione SQL ammette fino a 120). */
export const REMINDER_WINDOW_MAX_MINUTES = 60;

/**
 * Finestra di recupero in minuti per claim_due_meal_reminders: un pasto e' preso solo se il suo orario di promemoria e'
 * <= adesso e > adesso - finestra. Valori non numerici, <= 0 o con suffissi (es. "30abc") danno il default; i valori sopra
 * il massimo sono ridotti a REMINDER_WINDOW_MAX_MINUTES, cosi' nessun promemoria parte troppo in ritardo.
 */
export function parseReminderWindowMinutes(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return REMINDER_WINDOW_DEFAULT_MINUTES;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return REMINDER_WINDOW_DEFAULT_MINUTES;
  return Math.min(n, REMINDER_WINDOW_MAX_MINUTES);
}
