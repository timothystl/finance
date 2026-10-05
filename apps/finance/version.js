export const FINANCE_VERSION = '0.1.0-alpha.1';
export const FINANCE_RELEASE_CHANNEL = 'alpha';

// The release number (the deploy workflow's run number, which only grows) replaces the last part of
// the version, so the number on screen changes with every release and shows whether one went live.
export function financeVersion(env) {
  const n = String(env?.RELEASE_NUMBER || '');
  return /^\d{1,6}$/.test(n) ? FINANCE_VERSION.replace(/\.\d+$/, `.${n}`) : FINANCE_VERSION;
}
