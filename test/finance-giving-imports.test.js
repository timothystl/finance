import { describe, it, expect } from 'vitest';
import { Script } from 'node:vm';
import worker from '../apps/finance/shell.js';
import { IMPORT_SCRIPT } from '../apps/finance/giving-import-pages.js';

function env(role = 'admin') {
  const calls = [];
  return { calls, ENVIRONMENT: 'production', FINANCE_CONTRACT_API_KEY: 'key', CONNECT_SERVICE: {
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith('staff-role-v1')) return Response.json({ role, identity: 'test@example.test', permissions: { finance: 'edit', giving: 'edit' } });
      if (url.pathname.endsWith('giving-import-v1')) {
        calls.push(req.method === 'POST' ? await req.json() : {});
        return Response.json(req.method === 'POST' ? { id: 'job-1', cursor: 10, total: 10, complete: true } : { jobs: [], unmatched: [] });
      }
      return new Response('{}', { status: 503 });
    },
  } };
}
const headers = { 'Cf-Access-Jwt-Assertion': 'test-jwt', Origin: 'https://finance.test' };
function request(form, extra = {}) { return new Request('https://finance.test/api/v1/giving-import', { method: 'POST', body: form, headers: { ...headers, ...extra } }); }
describe('official import interface', () => {
  it('offers official Breeze and CSV previews in Finance, with the self-only script policy', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=data&page=giving-imports', { headers }), env());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    const html = await res.text();
    expect(html).toContain('Preview Breeze contributions');
    expect(html).toContain('Preview CSV contributions');
    expect(html).toContain('Saved previews and imports');
    new Script(IMPORT_SCRIPT);
  });
  it('forwards the complete CSV, including quoted newlines, for a preview only', async () => {
    const state = env(); const form = new FormData();
    const csv = 'Payment ID,Date,Amount,Fund(s),Note\n1,2026-01-01,10,1 General,"line one\nline two"';
    form.set('op', 'preview'); form.set('source', 'csv'); form.set('csv', new File([csv], 'giving.csv'));
    const res = await worker.fetch(request(form), state);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('job=job-1');
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ op: 'preview', source: 'csv', csv });
  });
  it('rejects cross-site requests and non-admins before invoking the import service', async () => {
    const form = new FormData(); form.set('op', 'apply'); form.set('job', 'job-1'); form.set('cursor', '0');
    const state = env();
    expect((await worker.fetch(request(form, { Origin: 'https://other.test' }), state)).status).toBe(403);
    expect(state.calls).toHaveLength(0);
    expect((await worker.fetch(request(form), env('finance'))).status).toBe(403);
    expect((await worker.fetch(new Request('https://finance.test/api/v1/breeze-giving-sync', { method: 'POST', body: form, headers: { ...headers, Origin: 'https://other.test' } }), state)).status).toBe(403);
  });
});
