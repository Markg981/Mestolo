/**
 * Inviti: RLS (solo il proprietario li vede), anteprima pubblica minima e casi limite di accept_invite.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let pool: pg.Pool;

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function createUser(username: string): Promise<string> {
  const rows = await admin<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${username}@example.test`, JSON.stringify({ username, locale: 'it' })],
  );
  return rows[0].id;
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Crea un invito per conto dell'utente (come fa l'app: via RLS, con il solo hash). */
async function invite(uid: string): Promise<{ token: string; id: string }> {
  const token = randomBytes(32).toString('base64url');
  const rows = await as<{ id: string }>(uid, 'insert into public.invites (token_hash) values ($1) returning id', [hash(token)]);
  return { token, id: rows[0].id };
}

const accept = (uid: string | null, token: string) =>
  as<{ r: string }>(uid, 'select public.accept_invite($1) as r', [token]).then((rows) => rows[0].r);

d('Inviti', () => {
  let a: string;
  let b: string;
  let c: string;
  let e: string;
  let f: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    a = await createUser(`inva_${s}`);
    b = await createUser(`invb_${s}`);
    c = await createUser(`invc_${s}`);
    e = await createUser(`inve_${s}`);
    f = await createUser(`invf_${s}`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const status = (x: string, y: string) =>
    admin<{ status: string; requester_id: string }>(
      `select status, requester_id from public.friendships
       where least(requester_id, addressee_id) = least($1::uuid, $2::uuid) and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)`,
      [x, y],
    );

  it('RLS: solo il proprietario vede e revoca i propri inviti', async () => {
    const inv = await invite(a);
    expect(await as(a, 'select id from public.invites where id = $1', [inv.id])).toHaveLength(1);
    expect(await as(b, 'select id from public.invites where id = $1', [inv.id])).toHaveLength(0);
    await expect(as(null, 'select id from public.invites')).rejects.toThrow();
    expect(await as(b, 'update public.invites set revoked_at = now() where id = $1 returning id', [inv.id])).toHaveLength(0);
    expect(await as(a, 'update public.invites set revoked_at = now() where id = $1 returning id', [inv.id])).toHaveLength(1);
  });

  it('RLS: non si possono forzare uses/max_uses/scadenza ne\' creare inviti per altri', async () => {
    const t = randomBytes(32).toString('base64url');
    await expect(as(a, 'insert into public.invites (token_hash, max_uses) values ($1, 50)', [hash(t)])).rejects.toThrow();
    await expect(as(a, 'insert into public.invites (token_hash, inviter_id) values ($1, $2)', [hash(t), b])).rejects.toThrow();
    const inv = await invite(a);
    await expect(as(a, 'update public.invites set uses = 0, max_uses = 50 where id = $1', [inv.id])).rejects.toThrow();
    await expect(as(a, "update public.invites set expires_at = now() + interval '1 year' where id = $1", [inv.id])).rejects.toThrow();
  });

  it('il token in chiaro non e\' salvato e le redenzioni le vede solo l\'invitante', async () => {
    const inv = await invite(c);
    const rows = await admin<{ token_hash: string }>('select token_hash from public.invites where id = $1', [inv.id]);
    expect(rows[0].token_hash).toBe(hash(inv.token));
    expect(rows[0].token_hash).not.toContain(inv.token);
    await accept(b, inv.token);
    expect(await as(c, 'select 1 from public.invite_redemptions where invite_id = $1', [inv.id])).toHaveLength(1);
    expect(await as(e, 'select 1 from public.invite_redemptions where invite_id = $1', [inv.id])).toHaveLength(0);
    await expect(as(c, 'insert into public.invite_redemptions (invite_id, redeemer_id) values ($1, $2)', [inv.id, e])).rejects.toThrow();
  });

  it('limite di inviti attivi per utente', async () => {
    const user = await createUser(`invl_${Math.random().toString(36).slice(2, 7)}`);
    for (let i = 0; i < 10; i++) await invite(user);
    await expect(invite(user)).rejects.toMatchObject({ code: 'RL002' });
  });

  it('anteprima pubblica: solo username e nome, uguale per ogni causa di invalidita\'', async () => {
    const inv = await invite(a);
    const ok = await as<{ username: string; display_name: string }>(null, 'select * from public.invite_preview($1)', [inv.token]);
    expect(ok).toHaveLength(1);
    expect(Object.keys(ok[0]).sort()).toEqual(['display_name', 'username']);
    expect(await as(null, 'select * from public.invite_preview($1)', [randomBytes(32).toString('base64url')])).toHaveLength(0);
    expect(await as(null, 'select * from public.invite_preview($1)', [null])).toHaveLength(0);
    await admin('update public.invites set revoked_at = now() where id = $1', [inv.id]);
    expect(await as(null, 'select * from public.invite_preview($1)', [inv.token])).toHaveLength(0);
  });

  it('accept_invite: crea un\'amicizia accettata e consuma un uso', async () => {
    const inv = await invite(a);
    expect(await accept(e, inv.token)).toBe('accepted');
    expect(await status(a, e)).toEqual([{ status: 'accepted', requester_id: e }]);
    const [row] = await admin<{ uses: number }>('select uses from public.invites where id = $1', [inv.id]);
    expect(row.uses).toBe(1);
  });

  it('accept_invite: non accessibile ad anon', async () => {
    const inv = await invite(a);
    await expect(accept(null, inv.token)).rejects.toThrow();
  });

  it('accept_invite: token inesistente, scaduto, revocato, esaurito e proprio danno lo stesso errore', async () => {
    const unknown = randomBytes(32).toString('base64url');
    const expired = await invite(a);
    await admin("update public.invites set expires_at = now() - interval '1 minute' where id = $1", [expired.id]);
    const revoked = await invite(a);
    await as(a, 'update public.invites set revoked_at = now() where id = $1', [revoked.id]);
    const exhausted = await invite(a);
    await admin('update public.invites set max_uses = 1, uses = 1 where id = $1', [exhausted.id]);
    const own = await invite(a);
    for (const tok of [unknown, expired.token, revoked.token, exhausted.token, own.token]) {
      await expect(accept(f, tok)).rejects.toMatchObject({ code: 'IV001', message: 'invalid_invite' });
    }
    await expect(accept(a, own.token)).rejects.toMatchObject({ code: 'IV001' });
    expect(await status(a, f)).toEqual([]);
  });

  it('accept_invite: utenti bloccati ricevono l\'errore generico', async () => {
    const x = await createUser(`invx_${Math.random().toString(36).slice(2, 7)}`);
    const inv = await invite(a);
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [x, a]);
    await expect(accept(x, inv.token)).rejects.toMatchObject({ code: 'IV001' });
  });

  it('accept_invite: gia\' amici e riuso dello stesso utente non consumano usi', async () => {
    const inv = await invite(b);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [b, f]);
    expect(await accept(f, inv.token)).toBe('already_friends');
    const g = await createUser(`invg_${Math.random().toString(36).slice(2, 7)}`);
    expect(await accept(g, inv.token)).toBe('accepted');
    expect(await accept(g, inv.token)).toBe('already_friends');
    const [row] = await admin<{ uses: number }>('select uses from public.invites where id = $1', [inv.id]);
    expect(row.uses).toBe(1);
  });

  it('accept_invite: sostituisce una richiesta pendente o rifiutata', async () => {
    const p = await createUser(`invp_${Math.random().toString(36).slice(2, 7)}`);
    const q = await createUser(`invq_${Math.random().toString(36).slice(2, 7)}`);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'pending')", [a, p]);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'declined')", [q, a]);
    const inv = await invite(a);
    expect(await accept(p, inv.token)).toBe('accepted');
    expect(await accept(q, inv.token)).toBe('accepted');
    expect((await status(a, p))[0].status).toBe('accepted');
    expect((await status(a, q))[0].status).toBe('accepted');
  });

  it('accept_invite: si ferma a max_uses e il limite giornaliero non pesa sull\'invitante', async () => {
    const inv = await invite(a);
    await admin('update public.invites set max_uses = 2 where id = $1', [inv.id]);
    const users = [await createUser(`invu1_${Math.random().toString(36).slice(2, 7)}`), await createUser(`invu2_${Math.random().toString(36).slice(2, 7)}`), await createUser(`invu3_${Math.random().toString(36).slice(2, 7)}`)];
    expect(await accept(users[0], inv.token)).toBe('accepted');
    expect(await accept(users[1], inv.token)).toBe('accepted');
    await expect(accept(users[2], inv.token)).rejects.toMatchObject({ code: 'IV001' });
    const counts = await admin<{ n: number }>("select coalesce(sum(n), 0)::int as n from public.daily_action_counts where user_id = $1 and action = 'friend_request'", [a]);
    expect(counts[0].n).toBeLessThan(5);
  });
});
