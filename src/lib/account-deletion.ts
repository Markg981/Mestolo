const BUCKET = 'recipe-images';
const CHUNK = 100;

type ImgRow = { storage_path: string; thumb_path: string | null };

/** Minimal slice of the Supabase admin client used here (keeps the flow unit-testable). */
export interface DeletionAdmin {
  from(table: 'recipe_images' | 'cook_logs'): {
    select(cols: string): { eq(col: string, val: string): PromiseLike<{ data: unknown; error: { message: string } | null }> };
  };
  storage: {
    from(bucket: string): { remove(paths: string[]): PromiseLike<{ error: { message: string } | null }> };
  };
  auth: {
    admin: { deleteUser(id: string): PromiseLike<{ error: { message?: string; status?: number; code?: string } | null }> };
  };
}

/**
 * Deletes an account in a retry-safe order:
 *  1. collect the user's file paths (rows still exist, so a retry sees them again);
 *  2. remove the files (removing a missing file is a no-op, so retries are idempotent);
 *  3. delete the auth user last (all rows cascade). "User not found" counts as success.
 * Any failure before step 3 aborts without touching the auth user, so nothing is orphaned
 * or left unreachable; the caller can simply retry. Signing out is the caller's job.
 */
export async function deleteAccountData(admin: DeletionAdmin, userId: string): Promise<void> {
  const { data, error: listError } = await admin.from('recipe_images').select('storage_path, thumb_path').eq('owner_id', userId);
  if (listError) throw new Error(`list images failed: ${listError.message}`);
  const paths = ((data as ImgRow[] | null) ?? []).flatMap((i) => [i.storage_path, i.thumb_path].filter(Boolean) as string[]);
  // Foto del diario «L'ho cucinata»: stesso bucket, rimosse subito (il cron resta rete di sicurezza).
  const { data: logs, error: logsError } = await admin.from('cook_logs').select('photo_path').eq('user_id', userId);
  if (logsError) throw new Error(`list cook photos failed: ${logsError.message}`);
  for (const l of (logs as { photo_path: string | null }[] | null) ?? []) if (l.photo_path) paths.push(l.photo_path);
  for (let i = 0; i < paths.length; i += CHUNK) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + CHUNK));
    if (error) throw new Error(`storage remove failed: ${error.message}`);
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error && error.status !== 404 && error.code !== 'user_not_found') throw new Error(`deleteUser failed: ${error.message ?? 'unknown'}`);
}
