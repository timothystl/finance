import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/finance/shell.js';
import { resetEnsuredSchemasForTests } from '../apps/finance/finance-owned-schema.js';
import { resetAccessJwtCacheForTests } from '../apps/finance/access-jwt.js';
import { resolvePageRole } from '../apps/finance/role-cache.js';

const TEAM = 'team.example.com';
const AUD = 'finance-aud';
const b64url = (buf) => Buffer.from(buf).toString('base64url');

let keyPair;
let publicJwk;
async function keys() {
  if (!keyPair) {
    keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    publicJwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1', alg: 'RS256' };
  }
}
async function jwt(claims) {
  await keys();
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const body = b64url(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: 'Admin@Example.org', exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
const certsFetch = async () => new Response(JSON.stringify({ keys: [publicJwk] }));

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return { meta: {} }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { sqlite, prepare: (sql) => statement(sql), async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; } };
}

function makeEnv(db = makeDb()) {
  const state = { mode: 'ok' };
  const env = {
    ENVIRONMENT: 'production', FINANCE_CONTRACT_API_KEY: 'k', FINANCE_DB: db,
    FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD,
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        if (!url.pathname.endsWith('/staff-role-v1')) return new Response('{}', { status: 404 });
        if (state.mode === 'timeout') { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
        if (state.mode === '503') return new Response('{}', { status: 503 });
        if (['401','403'].includes(state.mode)) return new Response('{}', { status: Number(state.mode) });
        if (state.mode === 'demoted') return Response.json({role:'council',identity:'admin@example.org',permissions:{finance:'view'}});
        return new Response(JSON.stringify({ role: 'admin', identity: 'admin@example.org', username: 'andrew', permissions: { finance: 'edit', giving: 'edit' } }));
      },
    },
  };
  return { env, db, state };
}

beforeEach(() => { resetEnsuredSchemasForTests(); resetAccessJwtCacheForTests(); });

describe('Finance live authorization', () => {
  async function seedCachedAdmin(db) {
    await resolvePageRole(makeEnv(db).env, await jwt({}));
    db.sqlite.exec("CREATE TABLE IF NOT EXISTS finance_role_cache(identity TEXT PRIMARY KEY,role TEXT,permissions_json TEXT,username TEXT,verified_at TEXT)");
    db.sqlite.prepare("INSERT OR REPLACE INTO finance_role_cache VALUES(?,?,?,?,datetime('now'))").run('admin@example.org','admin','{"finance":"edit","giving":"edit"}','test-admin');
  }

  it('never restores a cached administrator after denial followed by outage', async () => {
    const { env, db, state } = makeEnv();
    const token = await jwt({});
    await seedCachedAdmin(db);
    expect(await resolvePageRole(env, token)).toMatchObject({ok:true,role:'admin'});
    for (const denied of ['401','403']) {
      state.mode=denied;
      expect(await resolvePageRole(env, token)).toMatchObject({ok:false,status:Number(denied)});
      for (const failure of ['503','timeout']) {
        state.mode=failure;
        expect((await resolvePageRole(env, token)).ok).toBe(false);
      }
    }
  });

  it('uses current demoted permissions and never the historical administrator during outage', async () => {
    const {env,db,state}=makeEnv();
    const token=await jwt({});
    await seedCachedAdmin(db);
    state.mode='demoted';
    expect(await resolvePageRole(env, token)).toMatchObject({ok:true,role:'council',permissions:{finance:'view'}});
    state.mode='503';
    expect((await resolvePageRole(env, token)).ok).toBe(false);
  });

  it.each(['property','compensation','hr','payroll','accounts','packet','data'])('blocks %s pages before reading local data during an outage', async section => {
    const {env,db,state}=makeEnv();
    const token=await jwt({});
    await seedCachedAdmin(db);
    state.mode='timeout';
    const response=await worker.fetch(new Request('https://finance.test/?section='+section, {headers:{'Cf-Access-Jwt-Assertion':token}}),env);
    expect(response.status).not.toBe(200);
    expect(response.headers.get('Location')||await response.text()).toMatch(/access_denied|unavailable|Connect/i);
  });

  it('keeps saves on the live check', async () => {
    const { env, state } = makeEnv();
    const token = await jwt({});
    state.mode = 'timeout';
    const res = await worker.fetch(new Request('https://finance.test/api/v1/property/bank-rec-save', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token, 'Sec-Fetch-Site': 'same-origin' },
      body: new URLSearchParams({ statement_month: '2026-08', statement_balance: '1', book_balance: '1' }),
    }), env);
    expect(res.headers.get('Location')).toContain('access_denied');
  });
});
