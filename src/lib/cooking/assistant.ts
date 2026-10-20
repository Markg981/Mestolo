import { z } from 'zod';

/** Limits shared by client (truncation) and server (validation) of the cook assistant. */
export const COOK_QUESTION_MAX = 500;
export const COOK_TURN_MAX = 1200;
export const COOK_HISTORY_MAX_TURNS = 6;

export const cookTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(COOK_TURN_MAX),
});
export type CookTurn = z.infer<typeof cookTurnSchema>;

export const cookAskSchema = z.object({
  question: z.string().trim().min(1).max(COOK_QUESTION_MAX),
  history: z.array(cookTurnSchema).max(COOK_HISTORY_MAX_TURNS * 2).default([]),
  stepIndex: z.number().int().min(0).max(500),
  servings: z.number().positive().max(1000).nullable().default(null),
});
export type CookAskInput = z.input<typeof cookAskSchema>;

export const cookAnswerSchema = z.object({ answer: z.string().trim().min(1).max(4000) });

/** Keeps only the last N exchanges (2 turns each) and clips over-long turns. */
export function truncateHistory(history: CookTurn[], maxTurns = COOK_HISTORY_MAX_TURNS): CookTurn[] {
  return history
    .filter((t) => t.text.trim())
    .slice(-maxTurns * 2)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, COOK_TURN_MAX) }));
}
