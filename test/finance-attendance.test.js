import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import worker from '../apps/finance/shell.js';
import { renderAttendancePage } from '../apps/finance/attendance-pages.js';
import { fetchLiveAttendanceSummary } from '../apps/finance/finance-attendance-client.js';
import { acceptAttendanceSummaryV1 } from '../contracts/validators/attendance-summary-consumer.js';

const EXAMPLE = JSON.parse(fs.readFileSync(new URL('../contracts/examples/attendance-summary-v1.synthetic.json', import.meta.url), 'utf8'));

function env({ role = 'admin', permissions = { finance: 'edit' }, attendance = EXAMPLE, attendanceStatus = 200 } = {}) {
  return {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions }));
        if (pathname === '/api/contracts/attendance-summary-v1') {
          return attendanceStatus === 200 ? new Response(JSON.stringify(attendance)) : new Response('{}', { status: attendanceStatus });
        }
        return new Response('nf', { status: 404 });
      },
    },
  };
}
const get = async (path, e = env()) => {
  const res = await worker.fetch(new Request(`https://finance.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt' } }), e);
  return { status: res.status, html: await res.text() };
};

describe('attendance summary client', () => {
  it('accepts Connect’s own example', async () => {
    const result = await fetchLiveAttendanceSummary(env(), 2026);
    expect(result.ok).toBe(true);
    expect(result.attendance.fiscalYear).toBe(2026);
  });
  it('fails closed when a field is added (such as a name) or Connect errors', async () => {
    const withName = { ...EXAMPLE, services: [{ ...EXAMPLE.services[0], name: 'Jane Doe' }] };
    expect((await fetchLiveAttendanceSummary(env({ attendance: withName }), 2026)).reason).toBe('contract_validation_failed');
    expect((await fetchLiveAttendanceSummary(env({ attendanceStatus: 503 }), 2026)).reason).toBe('http_error');
    expect((await fetchLiveAttendanceSummary({}, 2026)).reason).toBe('not_configured');
    expect(() => acceptAttendanceSummaryV1({})).toThrow();
  });
});

describe('attendance pages', () => {
  it('shows this year with charts, tables, and the word Attendance (never head count)', async () => {
    const { status, html } = await get('/?section=attendance&page=overview');
    expect(status).toBe(200);
    expect(html).toContain('Worship attendance, FY2026');
    expect(html).toContain('Attendance by weekend');
    expect(html).toContain('Average attendance per weekend, by month');
    expect(html).toContain('Oct 4');
    expect(html).not.toMatch(/head ?count/i);
    expect((html.match(/<svg /g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('shows the multi-year view with one line per fiscal year', async () => {
    const { html } = await get('/?section=attendance&page=trend');
    expect(html).toContain('Attendance, multi-year');
    expect(html).toContain('2024');
    expect(html).toContain('2026');
  });

  it('says plainly when Connect cannot be read instead of showing zeros', async () => {
    const { html } = await get('/?section=attendance&page=overview', env({ attendanceStatus: 503 }));
    expect(html).toContain('Attendance could not be read from Connect');
    expect(html).not.toContain('Worship attendance, FY');
  });

  it('is offered in the board packet and prints as two pages', async () => {
    const { html } = await get('/print/board-packet');
    expect(html).toContain('value="attendance"');
    const printed = await get('/print/board-packet?include=attendance');
    expect(printed.html).toContain('Worship attendance, FY2026');
    expect(printed.html).toContain('Attendance, multi-year');
    expect(printed.html.match(/class="print-newpage"/g)).toHaveLength(2);
  });

  it('leaves out a month with no counts rather than drawing zero', () => {
    const html = renderAttendancePage('trend', { result: { ok: true, attendance: EXAMPLE } });
    expect(html).not.toContain('Jan · 2026: 0');
  });
});
