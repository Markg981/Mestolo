import { describe, expect, it, vi } from 'vitest';
import { deleteAccountData, type DeletionAdmin } from '@/lib/account-deletion';

function make(opts: { removeError?: boolean; deleteError?: { status?: number; code?: string; message?: string }; rows?: unknown[] } = {}) {
  const calls: string[] = [];
  const remove = vi.fn(async (p: string[]) => {
    calls.push(`remove:${p.length}`);
    return { error: opts.removeError ? { message: 'boom' } : null };
  });
  const deleteUser = vi.fn(async () => {
    calls.push('deleteUser');
    return { error: opts.deleteError ?? null };
  });
  const admin = {
    from: () => ({
      select: () => ({
        eq: async () => {
          calls.push('list');
          return { data: opts.rows ?? [{ storage_path: 'a', thumb_path: 'a_t' }, { storage_path: 'b', thumb_path: null }], error: null };
        },
      }),
    }),
    storage: { from: () => ({ remove }) },
    auth: { admin: { deleteUser } },
  } as unknown as DeletionAdmin;
  return { admin, calls, remove, deleteUser };
}

describe('deleteAccountData', () => {
  it('lists, removes files, then deletes the auth user last', async () => {
    const m = make();
    await deleteAccountData(m.admin, 'u1');
    expect(m.calls).toEqual(['list', 'remove:3', 'deleteUser']);
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
