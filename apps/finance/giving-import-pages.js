import { escapeHtml as e, formatCents } from './render-helpers.js';
import { isSameOriginPost } from './form-post.js';
import { fetchVerifiedRole } from './connect-role-client.js';

export async function importContract(env, jwt, body, job = '') {
  if (!env.CONNECT_SERVICE || !env.FINANCE_CONTRACT_API_KEY || !jwt) return { error: 'Your sign-in or the Connect connection is unavailable.' };
  try {
    const res = await env.CONNECT_SERVICE.fetch(new Request(`https://connect.timothystl.org/api/contracts/giving-import-v1${job ? `?job=${encodeURIComponent(job)}` : ''}`, {
      method: body ? 'POST' : 'GET', headers: { 'X-Contract-Key': env.FINANCE_CONTRACT_API_KEY, 'Cf-Access-Jwt-Assertion': jwt, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000),
    }));
    const result = await res.json();
    return res.ok ? result : { error: result.error || 'The import was refused.' };
  } catch { return { error: 'The import response was interrupted. Reload its saved preview to see progress before retrying.' }; }
}
const home = '/?section=data&page=giving-imports';
export async function handleGivingImport(request, env, url) {
  if (!isSameOriginPost(request, url)) return new Response('This request did not come from Finance.', { status: 403 });
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const role = await fetchVerifiedRole(env, jwt);
  if (!role.ok || role.role !== 'admin') return new Response('Giving imports require administrator access.', { status: 403 });
  if (Number(request.headers.get('Content-Length')) > 1200000) return new Response('Upload at most 1 MB.', { status: 413 });
  let form;
  try { form = await request.formData(); } catch { return new Response('The form could not be read.', { status: 400 }); }
  const op = String(form.get('op') || '');
  const job = String(form.get('job') || '');
  const body = { op, job, cursor: Number(form.get('cursor')), personRef: String(form.get('personRef') || ''), personId: Number(form.get('personId')) };
  if (op === 'preview') {
    body.source = String(form.get('source'));
    if (body.source === 'csv') {
      const file = form.get('csv');
      if (!file || typeof file.text !== 'function' || file.size > 1000000) return new Response('Choose a CSV file up to 1 MB.', { status: 400 });
      body.csv = await file.text();
    } else { body.start = String(form.get('start') || ''); body.end = String(form.get('end') || ''); }
  }
  const result = await importContract(env, jwt, body);
  if (request.headers.get('Accept') === 'application/json') return Response.json(result, { status: result.error ? 409 : 200 });
  const q = new URLSearchParams({ section: 'data', page: 'giving-imports', ...(result.id || job ? { job: result.id || job } : {}), ...(result.error ? { error: result.error } : {}) });
  return new Response(null, { status: 303, headers: { Location: `/?${q}` } });
}
export async function renderGivingImports(env, jwt, params) {
  const role = await fetchVerifiedRole(env, jwt);
  if (!role.ok || role.role !== 'admin') return '<section class="report"><h2>Giving imports</h2><p>Administrator access is required.</p></section>';
  const job = params.get('job') || '';
  const data = await importContract(env, jwt, undefined, job);
  const error = params.get('error') || data.error;
  const message = error ? `<p role="alert" class="status status-error">${e(error)}</p>` : '';
  if (job && !data.error) return `<section class="report"><h2>Review giving import</h2>${message}
    <p>${data.total} payments · ${formatCents(data.cents)} · ${data.protected} protected gifts kept unchanged · ${data.unmatched.length} unmatched Breeze donor numbers.</p>
    <p>Existing imported gifts will be refreshed with the exact fund splits shown. Gifts with local corrections or deposit links are kept for separate review. Missing gifts are never deleted automatically. People and permissions remain in Connect.</p>
    <p id="import-progress" role="status">${data.cursor} of ${data.total} processed. ${data.complete ? 'Import complete.' : 'Review the rows below before applying.'}</p>
    ${data.complete ? '' : `<form id="apply-import" method="POST" action="/api/v1/giving-import"><input type="hidden" name="op" value="apply"><input type="hidden" name="job" value="${e(job)}"><input type="hidden" name="cursor" value="${data.cursor}"><button type="submit">${data.cursor ? 'Resume import' : 'Apply reviewed import'}</button></form><script src="/giving-import.js" defer></script>`}
    <p><a href="${home}">Back to giving imports and donor matching</a></p>
    <table><thead><tr><th>Payment</th><th>Date</th><th>Amount</th><th>Funds</th><th>Action</th></tr></thead><tbody>${data.gifts.map(g => `<tr><td>${e(g.paymentId)}</td><td>${e(g.date)}</td><td>${formatCents(g.cents)}</td><td>${e(g.funds)}</td><td>${e(g.action)}</td></tr>`).join('')}</tbody></table></section>`;
  const today = new Date().toISOString().slice(0, 10);
  return `<section class="report"><h2>Giving imports</h2>${message}
    <p>Import official contributions here. These gifts feed giving reports, statements and batches. First preview, then apply. This is separate from the optional Breeze comparison copy.</p>
    <h3>From Breeze</h3><form method="POST" action="/api/v1/giving-import"><input type="hidden" name="op" value="preview"><input type="hidden" name="source" value="breeze"><label>From <input type="date" name="start" value="${today.slice(0, 8)}01" required></label> <label>Through <input type="date" name="end" value="${today}" required></label><p>Choose up to 32 days per preview.</p><button type="submit">Preview Breeze contributions</button></form>
    <h3>Upload giving CSV</h3><form method="POST" enctype="multipart/form-data" action="/api/v1/giving-import"><input type="hidden" name="op" value="preview"><input type="hidden" name="source" value="csv"><label>Breeze giving export <input type="file" name="csv" accept=".csv,.tsv,text/csv" required></label><p>Up to 1 MB. Include Payment ID, Date, Amount and Fund(s), with Breeze fund numbers. Person ID links gifts to existing people.</p><button type="submit">Preview CSV contributions</button></form>
    <h3>Unmatched imported donors</h3><p>Link the Breeze number to the correct person in Connect, then use Match gifts here. This fills only gifts without a donor; it never changes existing assignments.</p>${(data.unmatched || []).map(p => `<div>Breeze ${e(p.person_ref)} · ${p.gifts} gift lines ${p.person_id ? `<form method="POST" action="/api/v1/giving-import"><input type="hidden" name="op" value="match"><input type="hidden" name="personRef" value="${e(p.person_ref)}"><input type="hidden" name="personId" value="${p.person_id}"><button type="submit">Match gifts to ${e(p.person_name)}</button></form>` : '— no linked Connect person yet.'}</div>`).join('') || '<p>No unmatched imported donors.</p>'}
    <h3>Saved previews and imports</h3><ul>${(data.jobs || []).map(j => `<li><a href="${home}&amp;job=${e(j.id)}">${e(j.created_at)} · ${e(j.source)}</a> · ${j.cursor} processed</li>`).join('') || '<li>No imports yet.</li>'}</ul></section>`;
}
export const IMPORT_SCRIPT = `const form=document.getElementById('apply-import');if(form)form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;const status=document.getElementById('import-progress');try{for(;;){const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'}});const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||'Import paused. Reload to see saved progress.');form.elements.cursor.value=data.cursor;status.textContent=data.cursor+' of '+data.total+' processed.';if(data.complete){status.textContent+=' Import complete.';form.hidden=true;break;}}}catch(error){status.textContent=error.message;button.disabled=false;button.textContent='Resume import';}});`;
