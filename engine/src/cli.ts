// Dev runner: node src/cli.ts <sf org alias>. Uses the sf CLI's own session; reads only.
import { readFlows, promptCalls } from './flows.ts';
import { query } from './salesforce.ts';
import { readUnmetered } from './licence.ts';
import { readData360, rowsPerMonth, runsPerMonth, credits } from './data360.ts';
import { readScheduledApex } from './apex.ts';
import { readAgents, billing, isDefaultAgent, ACTION_CREDITS } from './agents.ts';
import { readAlerts } from './alerts.ts';
import { build, markdown, html } from './report.ts';
import { tierFor } from './rates.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const alias = process.argv[2];
if (!alias) { console.error('usage: node src/cli.ts <sf org alias>'); process.exit(2); }
// The sf CLI redacts tokens in its own output, so borrow its stored login through @salesforce/core, which also refreshes it.
const { AuthInfo, Connection, StateAggregator } = await import('@salesforce/core');
const username = (await StateAggregator.getInstance()).aliases.resolveUsername(alias);
const conn = await Connection.create({ authInfo: await AuthInfo.create({ username }) });
await conn.refreshAuth();
const s = { host: new URL(conn.instanceUrl).host, token: conn.accessToken! };

const t0 = Date.now();
const flows = await readFlows(s, (n, total) => { if (n % 20 === 0 || n === total) process.stderr.write(`  flows ${n}/${total}\n`); });
const calls = promptCalls(flows);
const licence = await readUnmetered(s);
console.log(`${alias}: ${flows.length} active flows read in ${((Date.now() - t0) / 1000).toFixed(1)}s; ${flows.filter((f) => f.prompts.length).length} call prompt templates`);
console.log(`unmetered licence: ${licence.exists ? `${licence.assigned} of ${licence.total} assigned (${licence.developerName})` : 'not in this org, so every prompt run is metered'}`);
for (const c of calls) console.log(`  ${c.runsAs === 'automated process' ? 'METERED ' : 'depends '} ${c.flow.label}: runs when ${c.flow.when}; calls ${c.template}${c.decisions.length ? ` only after the decision${c.decisions.length === 1 ? '' : 's'} ${c.decisions.join(', ')}` : ' on every run'} | ${c.why}`);

const sandbox = conn.instanceUrl.includes('.sandbox.');
try {
  const d = await readData360(s);
  console.log(`Data 360: ${d.streams.length} streams (${d.streams.filter((x) => x.status === 'ACTIVE').length} active), ${d.lakeObjects.length} lake objects, ${d.transforms.length} transforms, ${d.insights.length} calculated insights`);
  for (const st of d.streams) {
    const lake = d.lakeObjects.find((l) => l.name === st.lakeObject);
    const rows = rowsPerMonth(st, lake);
    console.log(`  ${st.status === 'ACTIVE' ? 'ACTIVE  ' : 'inactive'} ${st.name}: ${st.frequency}${st.hours ? ' x' + st.hours + '/day' : ''} ${st.mode}${st.fullRefreshEveryDays ? ', full refresh every ' + st.fullRefreshEveryDays : ''} | last run ${st.lastRun?.slice(0, 10) ?? 'never'}, ${st.rowsLastRun} rows added last run, ${st.rowsTotal} in total${lake ? `, lake object holds ${lake.records}` : ''} | about ${runsPerMonth(st)} runs and ${rows.low === rows.high ? rows.high : rows.low + ' to ' + rows.high} rows a month, ${credits(rows.high, sandbox)} credits`);
  }
  for (const t of d.transforms) console.log(`  transform ${t.name}: ${t.type} ${t.status} every ${t.frequency ?? '?'}, last run ${t.lastRun?.slice(0, 10) ?? 'never'} ${t.lastRunStatus ?? ''}`);
} catch (e: any) { console.log(`Data 360: not readable (${String(e.message).slice(0, 120)})`); }

const jobs = await readScheduledApex(s);
console.log(`Scheduled Apex: ${jobs.length} job${jobs.length === 1 ? '' : 's'}`);
for (const j of jobs) console.log(`  ${j.aiCalls.length ? 'METERED ' : 'no AI   '} ${j.job} (${j.namespace ? j.namespace + '.' : ''}${j.className}) ${j.cron ?? 'no schedule read'} = about ${j.runsPerMonth ?? '?'} runs a month${j.aiCalls.length ? ' | calls ' + j.aiCalls.map((c) => `${c.className}: ${c.apis.join('; ')}`).join(', ') : ''}${j.hidden.length ? ' | packaged, code not readable: ' + j.hidden.join(', ') : ''}`);
const agents = await readAgents(s);
console.log(`Agents: ${agents.length}, ${agents.filter((a) => a.active).length} active; each action ${ACTION_CREDITS[sandbox ? 'sandbox' : 'production']} credits`);
for (const a of agents) console.log(`  ${a.active ? 'ACTIVE  ' : 'inactive'} ${a.label} (${a.name}) ${a.type}${a.active ? ' v' + a.activeVersion : ''} | ${billing(a)}${isDefaultAgent(a) ? ' | the default agent: global search bills through it once Coworker is on' : ''}`);
const alerts = await readAlerts(s);
console.log(`Threshold alerts: ${alerts.length ? alerts.map((a) => `${a.name} ${a.type} ${a.scope} ${a.trigger} ${a.status}`).join('; ') : 'none set. Alerts notify, they never stop spend, but without one nobody is told at all'}`);

// The model behind each template the flows call, from a Metadata API retrieve (there is no queryable object).
const templates: Record<string, string | null> = {};
const wanted = [...new Set(calls.map((c) => c.template))];
if (wanted.length) {
  const { readTemplateModels } = await import('./templates.ts');
  // A metadata retrieve is queued on Salesforce's side and can sit in Pending for minutes on a busy sandbox (seen on
  // Lakewood, 15 Oct 2026). Poll it ourselves for a bounded time; the library's own poll signals a timeout as an event,
  // not an error. Without the models the report still runs, with the tier shown as a range.
  const t1 = Date.now();
  const started: any = await conn.metadata.retrieve({ apiVersion: 67, singlePackage: true, unpackaged: { version: '67.0', types: [{ name: 'GenAiPromptTemplate', members: wanted }] } as any });
  let zip: string | null = null;
  while (Date.now() - t1 < 90_000) {
    await new Promise((r) => setTimeout(r, 3_000));
    const st: any = await conn.metadata.checkRetrieveStatus(started.id);
    if (st.done) { zip = st.zipFile ?? null; break; }
  }
  if (zip) { for (const t of readTemplateModels(zip)) templates[t.name] = t.model; process.stderr.write(`  templates read in ${((Date.now() - t1) / 1000).toFixed(0)}s\n`); }
  else { for (const t of wanted) templates[t] = null; process.stderr.write(`  template models not read after ${((Date.now() - t1) / 1000).toFixed(0)}s; tiers shown as a range\n`); }
}
const report = build({ org: { name: alias, sandbox, scannedAt: new Date().toISOString() }, promptCalls: calls, templates, unmetered: licence, data360: await readData360(s).catch(() => ({ streams: [], lakeObjects: [], transforms: [], insights: [] })), jobs, agents, alerts });
mkdirSync('out', { recursive: true });
writeFileSync(`out/${alias}.md`, markdown(report));
writeFileSync(`out/${alias}.html`, html(report, conn.instanceUrl));
console.log(`report: ${report.findings.length} lines, counted ${report.total.low} to ${report.total.high} credits a month; models: ${JSON.stringify(Object.fromEntries(Object.entries(templates).map(([k, v]) => [k, `${v} (${tierFor(v)})`])))}; wrote out/${alias}.md and out/${alias}.html`);
