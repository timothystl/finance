import { acceptAttendanceSummaryV1 } from '../../contracts/validators/attendance-summary-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

async function fetchYear(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  let response;
  try {
    response = await binding.fetch(new Request(
      `https://connect.timothystl.org/api/contracts/attendance-summary-v1?fiscal_year=${encodeURIComponent(fiscalYear)}`,
      { headers: { 'X-Contract-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    ));
  } catch (error) {
    return { ok: false, reason: 'network_error', detail: error?.message || String(error) };
  }
  if (!response.ok) return { ok: false, reason: 'http_error', status: response.status };
  let payload;
  try { payload = await response.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
  try { return { ok: true, attendance: acceptAttendanceSummaryV1(payload) }; }
  catch (error) { return { ok: false, reason: 'contract_validation_failed', detail: error?.message || String(error) }; }
}

// connect.attendance-summary.v1: anonymous worship attendance (counts only), answered by Connect.
// The year asked for is required; the year before it is read too so rolling twelve-month and
// 52-week views can cross the new year, and is simply left out (`prior: null`) if it cannot be read.
// The page says plainly when the main year cannot be read rather than showing blank or zero figures.
export async function fetchLiveAttendanceSummary(env, fiscalYear) {
  const [current, prior] = await Promise.all([fetchYear(env, fiscalYear), fetchYear(env, fiscalYear - 1)]);
  if (!current.ok) return current;
  return { ok: true, attendance: current.attendance, prior: prior.ok ? prior.attendance : null };
}
