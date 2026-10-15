// Spike for the Flex Credit Pre-flight extension. Proves three things in the admin's own browser session:
// 1. the Salesforce session cookie is readable (the same route Salesforce Inspector Reloaded uses),
// 2. a Tooling API query works with it, including in an org that signs in with passkeys,
// 3. one flow's full definition can be read, which is what the real checks parse.
const out = document.getElementById('out');
const log = (line) => { out.textContent += '\n' + line; };

// Lightning pages live on *.lightning.force.com, but the API and its session cookie live on *.my.salesforce.com.
function apiHosts(host) {
  const list = [host];
  const m = host.match(/^(.+?)\.(sandbox\.|develop\.|scratch\.)?lightning\.force\.com$/);
  if (m) list.unshift(`${m[1]}.${m[2] ?? ''}my.salesforce.com`);
  return [...new Set(list)];
}

async function session() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = new URL(tab.url).host;
  for (const h of apiHosts(host)) {
    const c = await chrome.cookies.get({ url: `https://${h}/`, name: 'sid' });
    if (c?.value) return { host: h, sid: c.value };
  }
  throw new Error(`no Salesforce session cookie found for ${host}; is this a Salesforce tab, signed in?`);
}

async function call(s, path) {
  const r = await fetch(`https://${s.host}${path}`, { headers: { Authorization: `Bearer ${s.sid}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

document.getElementById('run').addEventListener('click', async () => {
  out.textContent = 'Running.';
  try {
    const s = await session();
    log(`1. session cookie: found on ${s.host} (${s.sid.length} characters, not shown)`);
    const org = await call(s, "/services/data/v67.0/query?q=SELECT+Id,Name,IsSandbox,OrganizationType+FROM+Organization");
    const o = org.records[0];
    log(`   org: ${o.Name} | ${o.OrganizationType} | sandbox=${o.IsSandbox}`);
    const flows = await call(s, "/services/data/v67.0/tooling/query?q=SELECT+COUNT()+FROM+FlowDefinition");
    log(`2. tooling query: ${flows.totalSize} flow definitions`);
    const one = await call(s, "/services/data/v67.0/tooling/query?q=SELECT+Id,DeveloperName,ActiveVersionId+FROM+FlowDefinition+WHERE+ActiveVersionId!=null+LIMIT+1");
    if (!one.records.length) { log('3. no active flow to read in this org (fine for the spike)'); return; }
    const def = one.records[0];
    const full = await call(s, `/services/data/v67.0/tooling/query?q=SELECT+Id,Metadata+FROM+Flow+WHERE+Id='${def.ActiveVersionId}'`);
    const md = full.records[0].Metadata;
    const actions = (md.actionCalls ?? []).map((a) => a.actionType);
    log(`3. read flow ${def.DeveloperName}: processType=${md.processType}, triggerType=${md.start?.triggerType ?? 'none'}, runInMode=${md.runInMode ?? 'default'}, actions=[${actions.join(', ') || 'none'}]`);
    log('\nAll three passed.');
  } catch (e) {
    log(`FAILED: ${e.message}`);
  }
});
