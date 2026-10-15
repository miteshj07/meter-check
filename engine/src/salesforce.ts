// The only thing that talks to Salesforce. In the extension it is given the session from the cookie; in the CLI, from sf.
export interface Session { host: string; token: string }
export const API = 'v67.0';

export async function get<T>(s: Session, path: string): Promise<T> {
  const r = await fetch(`https://${s.host}${path}`, { headers: { Authorization: `Bearer ${s.token}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

// An org without a feature has no object for it: Salesforce answers "sObject type X is not supported". Readers that
// depend on an optional feature return their fallback instead of failing the whole scan.
export async function optional<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (/not supported|INVALID_TYPE|No such column|INVALID_FIELD/i.test(String(e?.message))) return fallback;
    throw e;
  }
}

// Follows nextRecordsUrl so callers never see paging.
export async function query<T>(s: Session, soql: string, tooling = false): Promise<T[]> {
  let page = await get<{ records: T[]; done: boolean; nextRecordsUrl?: string }>(s, `/services/data/${API}/${tooling ? 'tooling/' : ''}query?q=${encodeURIComponent(soql)}`);
  const out = [...page.records];
  while (!page.done && page.nextRecordsUrl) { page = await get(s, page.nextRecordsUrl); out.push(...page.records); }
  return out;
}
