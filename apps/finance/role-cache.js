import { fetchVerifiedRole, PAGE_ROLE_TIMEOUT_MS } from './connect-role-client.js';

export async function resolvePageRole(env, accessJwt) {
  return fetchVerifiedRole(env, accessJwt, { timeoutMs: PAGE_ROLE_TIMEOUT_MS, retry: true });
}
