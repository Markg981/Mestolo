import { z } from 'zod';

/** Password rules shared by sign-up, reset and change-password. */
export const passwordSchema = z.string().min(8).max(200);
