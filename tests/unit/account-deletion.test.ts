import { describe, expect, it, vi } from 'vitest';
import { deleteAccountData, type DeletionAdmin } from '@/lib/account-deletion';

function make(opts: { removeError?: boolean; deleteError?: { status?: number; code?: string; message?: string }; rows?: unknown[]; cook?: unknown[]; cookError?: boolean } = {}) {
  const calls: string[] = [];
  const filters: string[] = [];
  const remove = vi.fn(async (p: string[]) => {
    calls.push(`remove:${p.length}`);
    return { error: opts.removeError ? { message: 'boom' } : null };
  });
  const deleteUser = vi.fn(async () => {
    calls.push('deleteUser');
    return { error: opts.deleteError ?? null };
  });
  const admin = {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: async (col: string, val: string) => {
          filters.push(`${table}(${cols}).${col}=${val}`);
          if (table === 'cook_logs') return opts.cookError ? { data: null, error: { message: 'boom' } } : { data: opts.cook ?? [], error: null };
          calls.push('list');
          return { data: opts.rows ?? [{ storage_path: 'a', thumb_path: 'a_t' }, { storage_path: 'b', thumb_path: null }], error: null };
        },
      }),
    }),
    storage: { from: () => ({ remove }) },
    auth: { admin: { deleteUser } },
  } as unknown as DeletionAdmin;
  return { admin, calls, filters, remove, deleteUser };
}

describe('deleteAccountData', () => {
  it('lists, removes files, then deletes the auth user last', async () => {
    const m = make();
    await deleteAccountData(m.admin, 'u1');
    expect(m.calls).toEqual(['list', 'remove:3', 'deleteUser']);
  });

  it('removes the cooked-diary photos too, skipping logs without photo', async () => {
    const m = make({ rows: [], cook: [{ photo_path: 'u1/cook/x.webp' }, { photo_path: null }] });
    await deleteAccountData(m.admin, 'u1');
    expect(m.remove).toHaveBeenCalledWith(['u1/cook/x.webp']);
    expect(m.calls).toEqual(['list', 'remove:1', 'deleteUser']);
  });

  it('filters each table by the column that holds the user, and removes all files together', async () => {
    const m = make({ cook: [{ photo_path: 'u1/cook/x.webp' }] });
    await deleteAccountData(m.admin, 'u1');
    expect(m.filters).toEqual(['recipe_images(storage_path, thumb_path).owner_id=u1', 'cook_logs(photo_path).user_id=u1']);
    expect(m.remove).toHaveBeenCalledWith(['a', 'a_t', 'b', 'u1/cook/x.webp']);
  });

  it('does not touch storage nor the auth user if listing the cooked-diary photos fails', async () => {
    const m = make({ cookError: true });
    await expect(deleteAccountData(m.admin, 'u1')).rejects.toThrow(/cook photos/);
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it('chunks removals by 100', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ storage_path: `p${i}`, thumb_path: null }));
    const m = make({ rows });
    await deleteAccountData(m.admin, 'u1');
    expect(m.calls).toEqual(['list', 'remove:100', 'remove:100', 'remove:50', 'deleteUser']);
  });

  it('does not delete the auth user if storage removal fails', async () => {
    const m = make({ removeError: true });
    await expect(deleteAccountData(m.admin, 'u1')).rejects.toThrow();
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it('skips storage when there are no files', async () => {
    const m = make({ rows: [] });
    await deleteAccountData(m.admin, 'u1');
    expect(m.calls).toEqual(['list', 'deleteUser']);
  });

  it('is idempotent when the user is already gone', async () => {
    const m = make({ deleteError: { status: 404, code: 'user_not_found' } });
    await expect(deleteAccountData(m.admin, 'u1')).resolves.toBeUndefined();
  });

  it('fails on other deleteUser errors so it can be retried', async () => {
    const m = make({ deleteError: { status: 500, message: 'x' } });
    await expect(deleteAccountData(m.admin, 'u1')).rejects.toThrow();
  });
});
