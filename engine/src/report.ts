// The report: one list of everything that spends credits without a person clicking, each line with the rule it rests
// on, an estimate with its basis, and where to change it. Pure: takes what the readers returned, gives back structure,
// then Markdown or HTML.
import type { PromptCall } from './flows.ts';
import type { Unmetered } from './licence.ts';
import { rowsPerMonth, runsPerMonth, credits as prepCredits, type Data360 } from './data360.ts';
import type { ScheduledJob } from './apex.ts';
import { billing, isDefaultAgent, type Agent } from './agents.ts';
import type { Alert } from './alerts.ts';
import { ACTION_CREDITS, RATES_AS_OF, RATES_SOURCE, REPORTED_USD_PER_100K, promptCredits, tierFor, usd, type Tier } from './rates.ts';

export interface Finding {
  kind: 'flow' | 'apex' | 'agent' | 'stream' | 'transform' | 'licence' | 'alerts';
  title: string;
  billed: 'yes' | 'depends' | 'no' | 'unknown';
  rule: string; // Salesforce's rule, in a sentence
  basis: string; // what the estimate is built from
  perMonth: { low: number; high: number } | null; // credits
  action: string; // what to change, and where
  setup: string; // the Setup page
}
export interface Input {
  org: { name: string; sandbox: boolean; scannedAt: string };
  promptCalls: PromptCall[];
  templates: Record<string, string | null>; // template API name -> model API name of the active version
  unmetered: Unmetered;
  data360: Data360;
  jobs: ScheduledJob[];
  agents: Agent[];
  alerts: Alert[];
  volumes?: Record<string, number>; // optional runs-per-month the admin typed or allowed us to count, by flow name
}
export interface Report { org: Input['org']; findings: Finding[]; total: { low: number; high: number }; ratesAsOf: string; notes: string[] }

const sum = (xs: ({ low: number; high: number } | null)[]) => xs.reduce((a, x) => (x ? { low: a.low + x.low, high: a.high + x.high } : a), { low: 0, high: 0 });

export function build(i: Input): Report {
  const env = i.org.sandbox ? 'sandbox' : 'production';
  const f: Finding[] = [];

  // Prompts from flows. Credits per call come from the model's tier; runs per month from the admin, else unknown.
  for (const c of i.promptCalls) {
    const model = i.templates[c.template] ?? null;
    const tier: Tier = tierFor(model);
    const per = promptCredits(tier);
    const runs = i.volumes?.[c.flow.name];
    const metered = c.runsAs === 'automated process' ? 'yes' : i.unmetered.exists ? 'depends' : 'yes';
    f.push({
      kind: 'flow',
      title: `${c.flow.label} calls prompt template ${c.template}`,
      billed: metered,
      rule: c.runsAs === 'automated process' ? `${c.why}, and a prompt that does not run as the current user is metered.` : i.unmetered.exists ? `${c.why}; it is unmetered only when that person holds the Unmetered User Based AI licence (${i.unmetered.assigned} of ${i.unmetered.total} assigned here).` : `${c.why}; it would be unmetered only with the Unmetered User Based AI licence, which this org does not have, so every run is metered.`,
      basis: `Runs when ${c.flow.when}${c.decisions.length ? `, only after ${c.decisions.join(', ')}` : ''}. ${model ? `Model ${model}: ${tier === 'unknown' ? 'tier not known, 2 to 16' : `${tier} tier, ${per.low}`} credits a call.` : 'Model not read; 2 to 16 credits a call.'}${runs == null ? ' Runs a month not counted yet.' : ` About ${runs} runs a month.`}`,
      perMonth: runs == null ? null : { low: runs * per.low, high: runs * per.high },
      action: c.runsAs === 'automated process' ? 'If a person can trigger it instead, move the prompt to the immediate path or a screen flow and license those users; otherwise budget for it.' : 'License the users who trigger it with Unmetered User Based AI, or budget for it.',
      setup: 'Flows',
    });
  }

  // Scheduled Apex that calls AI: always metered.
  for (const j of i.jobs) {
    if (!j.aiCalls.length && !j.hidden.length) continue;
    const runs = j.runsPerMonth;
    f.push({
      kind: 'apex',
      title: `Scheduled job ${j.job} (${j.className})${j.aiCalls.length ? ' calls generative AI' : ' runs packaged code we cannot read'}`,
      billed: j.aiCalls.length ? 'yes' : 'unknown',
      rule: 'Scheduled Apex and batch jobs run in the background, with no current user, so every AI call they make is metered.',
      basis: `${j.cron ? `Schedule ${j.cron}, about ${runs} runs a month.` : 'Schedule not read.'} ${j.aiCalls.length ? j.aiCalls.map((a) => `${a.className} uses ${a.apis.join('; ')}`).join('. ') + '. Calls per run are not countable from code.' : `Code in ${j.hidden.join(', ')} is packaged and hidden from the API; ask the publisher whether it calls AI.`}`,
      perMonth: null,
      action: j.aiCalls.length ? 'Decide whether the job needs AI on every run; batch or throttle it, and set a consumption alert before it next runs.' : 'Ask the package publisher, or run the job once in a sandbox and read the usage data model afterwards.',
      setup: 'ScheduledJobs',
    });
  }

  // Agents: an action is 20 credits (16 in a sandbox). Volume is conversations, which metadata cannot see.
  for (const a of i.agents) {
    const b = billing(a);
    if (b === 'not running') continue;
    f.push({
      kind: 'agent',
      title: `Agent ${a.label} is active (${a.type.replace(/^Agentforce/, '')}${isDefaultAgent(a) ? ', the default agent' : ''})`,
      billed: b === 'metered' ? 'yes' : i.unmetered.exists ? 'depends' : 'yes',
      rule: b === 'metered' ? 'A service agent acts for people outside the org, so every action is metered.' : `An employee-facing agent is unmetered only for users holding the Unmetered User Based AI licence${i.unmetered.exists ? ` (${i.unmetered.assigned} of ${i.unmetered.total} assigned)` : ', which this org does not have'}.`,
      basis: `Each action is ${ACTION_CREDITS[env]} credits here. Actions a month depend on conversations, which setup data cannot show; read the usage data model or Digital Wallet for last month's count.${isDefaultAgent(a) ? ' Once Coworker is on, global search bills through this agent too.' : ''}`,
      perMonth: null,
      action: 'Confirm who uses it and license them, or deactivate the version until there is a budget.',
      setup: 'EinsteinCopilot',
    });
  }

  // Data 360: rows processed, priced by the rate card.
  for (const st of i.data360.streams) {
    if (st.status !== 'ACTIVE' || !runsPerMonth(st)) continue;
    const lake = i.data360.lakeObjects.find((l) => l.name === st.lakeObject);
    const rows = rowsPerMonth(st, lake);
    const per = { low: prepCredits(rows.low, i.org.sandbox), high: prepCredits(rows.high, i.org.sandbox) };
    f.push({
      kind: 'stream',
      title: `Data stream ${st.name} refreshes ${st.frequency === 'HOURLY' ? 'every hour' : `${st.hours ?? 1} time${(st.hours ?? 1) === 1 ? '' : 's'} a day`} (${st.mode.toLowerCase()}${st.fullRefreshEveryDays ? `, full refresh every ${st.fullRefreshEveryDays.replace(/\D/g, '')} days` : ''})`,
      billed: 'yes',
      rule: 'Data 360 services consume credits whenever they process rows, whether or not any AI call is involved.',
      basis: `About ${runsPerMonth(st)} runs a month. ${st.mode === 'FULL' ? `A full refresh reprocesses the whole lake object, ${lake?.records ?? st.rowsTotal} rows.` : `Last run added ${st.rowsLastRun} rows${st.fullRefreshEveryDays ? `; each full refresh reprocesses ${lake?.records ?? st.rowsTotal}` : ''}.`} ${rows.low === rows.high ? rows.high : `${rows.low} to ${rows.high}`} rows a month at the prep rate.`,
      perMonth: per,
      action: st.mode === 'FULL' ? 'Switch the stream to incremental refresh if the source supports it, or refresh less often.' : 'Keep it incremental; watch the full-refresh interval and the row count.',
      setup: 'DataStreams',
    });
  }
  for (const t of i.data360.transforms) {
    if (!/ACTIVE/i.test(t.status)) continue;
    f.push({ kind: 'transform', title: `Data transform ${t.name} (${t.type}) runs ${t.frequency ? `every ${t.frequency}` : 'on its schedule'}`, billed: 'yes', rule: 'Each transform run processes rows and is billed at the Data 360 prep rate.', basis: `Last run ${t.lastRun?.slice(0, 10) ?? 'never'} ${t.lastRunStatus ?? ''}. Rows per run are not exposed; check the transform\'s run history.`, perMonth: null, action: 'Confirm the schedule matches how often the data actually changes.', setup: 'DataTransforms' });
  }

  // Licence coverage and alerts: context lines, not costs.
  f.push({ kind: 'licence', title: i.unmetered.exists ? `Unmetered User Based AI: ${i.unmetered.assigned} of ${i.unmetered.total} licences assigned` : 'No Unmetered User Based AI licence in this org', billed: 'no', rule: 'Only a licensed user, acting as themselves, is unmetered. Everything else that calls AI is metered.', basis: i.unmetered.exists ? 'From the permission set licence counts.' : 'The licence is not provisioned, so nothing here can be unmetered until it is.', perMonth: null, action: i.unmetered.exists ? 'Assign it to the people who trigger prompts and use employee agents.' : 'Ask your account team whether your edition includes it; until then, every AI run above is billed.', setup: 'PermSetLicensing' });
  f.push({ kind: 'alerts', title: i.alerts.length ? `${i.alerts.length} consumption alert${i.alerts.length === 1 ? '' : 's'} set` : 'No consumption threshold alert set', billed: 'no', rule: 'Alerts notify when a threshold is crossed. They never stop spend.', basis: i.alerts.length ? i.alerts.map((a) => `${a.name}: ${a.type} ${a.scope} ${a.trigger} (${a.status})`).join('; ') : 'Zero alerts means nobody is told, at any level of spend.', perMonth: null, action: i.alerts.length ? 'Check the thresholds against the estimates above.' : 'Set one in Digital Wallet before switching anything on.', setup: 'DigitalWallet' });

  const total = sum(f.map((x) => x.perMonth));
  const notes = [
    `Rates as of ${RATES_AS_OF} (${RATES_SOURCE}). Dollar figures use the reported list price of $${REPORTED_USD_PER_100K} per 100,000 credits; your contract may differ.`,
    'Every figure is an estimate from setup data. This report cannot cap or stop spending; only Salesforce can.',
    f.some((x) => x.perMonth === null && x.billed !== 'no') ? 'Lines without a figure are billed but not countable from setup data; the usage data model or Digital Wallet shows what they cost last month.' : '',
  ].filter(Boolean);
  return { org: i.org, findings: f, total, ratesAsOf: RATES_AS_OF, notes };
}

const n = (x: number) => x.toLocaleString('en-US');
const money = (c: { low: number; high: number }) => (c.low === c.high ? `${n(c.high)} credits, about $${usd(c.high).toFixed(0)}` : `${n(c.low)} to ${n(c.high)} credits, about $${usd(c.low).toFixed(0)} to $${usd(c.high).toFixed(0)}`);

export function markdown(r: Report): string {
  const lines = [`# Meter Check: ${r.org.name}`, '', `${r.org.sandbox ? 'Sandbox' : 'Production'}, scanned ${r.org.scannedAt.slice(0, 16).replace('T', ' ')} UTC. Rates as of ${r.ratesAsOf}.`, '',
    `**Counted so far: ${money(r.total)} a month**, from the lines with a figure. ${r.findings.filter((f) => f.perMonth === null && f.billed !== 'no').length} more billed lines have no figure yet.`, ''];
  for (const f of r.findings) {
    lines.push(`## ${f.title}`, '', `Billed: ${f.billed}${f.perMonth ? ` | about ${money(f.perMonth)} a month` : ''}`, '', `Why: ${f.rule}`, '', `Basis: ${f.basis}`, '', `What to do: ${f.action} (Setup: ${f.setup})`, '');
  }
  lines.push('---', '', ...r.notes.map((x) => `- ${x}`), '');
  return lines.join('\n');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export function html(r: Report, setupBase?: string): string {
  const link = (node: string) => (setupBase ? `<a href="${esc(setupBase)}/lightning/setup/${esc(node)}/home">Open in Setup</a>` : esc(node));
  const row = (f: Finding) => `<tr class="${f.billed}"><td>${esc(f.title)}</td><td>${f.billed}</td><td>${f.perMonth ? esc(money(f.perMonth)) : f.billed === 'no' ? '' : 'not countable'}</td><td>${esc(f.rule)}<br><small>${esc(f.basis)}</small></td><td>${esc(f.action)}<br>${link(f.setup)}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Meter Check: ${esc(r.org.name)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;color:#1B2431;background:#F6F7F5}main{max-width:1100px;margin:0 auto}h1{font-size:24px}table{border-collapse:collapse;width:100%;background:#fff;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #D9DEE3}th{background:#EEF0EE}tr.yes td:nth-child(2){color:#9B1C1C;font-weight:700}tr.depends td:nth-child(2){color:#B45309;font-weight:700}small{color:#5A6473}.total{font-size:18px;margin:12px 0 20px}.notes{font-size:13px;color:#5A6473;margin-top:20px}</style></head><body><main>
<h1>Meter Check: ${esc(r.org.name)}</h1>
<p>${r.org.sandbox ? 'Sandbox' : 'Production'}, scanned ${esc(r.org.scannedAt.slice(0, 16).replace('T', ' '))} UTC. Rates as of ${esc(r.ratesAsOf)}.</p>
<p class="total"><strong>Counted so far: ${esc(money(r.total))} a month</strong>, from the lines with a figure.</p>
<table><thead><tr><th>What</th><th>Billed</th><th>A month</th><th>Why, and the basis</th><th>What to do</th></tr></thead><tbody>${r.findings.map(row).join('')}</tbody></table>
<div class="notes">${r.notes.map((x) => `<p>${esc(x)}</p>`).join('')}</div>
</main></body></html>`;
}
