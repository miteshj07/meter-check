import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, markdown, html, type Input } from '../src/report.ts';
import { fromMetadata, promptCalls } from '../src/flows.ts';

const flow = fromMetadata('Nightly', { label: 'Nightly summaries', processType: 'AutoLaunchedFlow', start: { triggerType: 'Scheduled', connector: { targetReference: 'P' } }, actionCalls: [{ name: 'P', actionType: 'generatePromptResponse', actionName: 'Summarise_Case' }] });
const base: Input = {
  org: { name: 'Acme', sandbox: false, scannedAt: '2026-10-16T09:00:00.000Z' },
  promptCalls: promptCalls([flow]),
  templates: { Summarise_Case: 'sfdc_ai__DefaultGPT5Mini' },
  unmetered: { exists: false, total: 0, assigned: 0, developerName: null },
  data360: { streams: [{ name: 'Account_Home', status: 'ACTIVE', frequency: 'BATCH', hours: 1, mode: 'FULL', fullRefreshEveryDays: null, lastRun: null, rowsLastRun: 0, rowsTotal: 2_000_000, lakeObject: 'Account_Home' }], lakeObjects: [{ name: 'Account_Home', records: 2_000_000, lastRefresh: null }], transforms: [], insights: [] },
  jobs: [{ job: 'Nightly scan', className: 'GTScheduledScan', namespace: 'truenorth', cron: '0 0 2 * * ?', runsPerMonth: 30, nextRun: null, aiCalls: [], hidden: ['truenorth.GTScheduledScan'] }],
  agents: [{ name: 'Service_Bot', label: 'Service Bot', type: 'AgentforceServiceAgent', active: true, activeVersion: 2, versions: 2 }, { name: 'Old', label: 'Old', type: 'AgentforceEmployeeAgent', active: false, activeVersion: null, versions: 1 }],
  alerts: [],
};

test('a scheduled flow prompt is billed by rule; without a run count it has no figure, with one it does', () => {
  const r = build(base);
  const flowLine = r.findings.find((f) => f.kind === 'flow')!;
  assert.equal(flowLine.billed, 'yes');
  assert.match(flowLine.rule, /Automated Process User/);
  assert.equal(flowLine.perMonth, null);
  const counted = build({ ...base, volumes: { Nightly: 30 } }).findings.find((f) => f.kind === 'flow')!;
  assert.deepEqual(counted.perMonth, { low: 60, high: 60 }, 'GPT-5 Mini is a basic prompt: 2 credits a call, 30 runs');
  assert.deepEqual(build({ ...base, templates: { Summarise_Case: 'sfdc_ai__SomeFutureModel' }, volumes: { Nightly: 30 } }).findings.find((f) => f.kind === 'flow')!.perMonth, { low: 60, high: 480 }, 'an unlisted model reports the full range');
});

test('a daily full refresh of two million rows is the big line, and totals add only what is counted', () => {
  const r = build(base);
  const stream = r.findings.find((f) => f.kind === 'stream')!;
  assert.deepEqual(stream.perMonth, { low: 2400, high: 2400 });
  assert.match(stream.basis, /60,000,000|60000000/);
  assert.deepEqual(r.total, { low: 2400, high: 2400 });
});

test('packaged scheduled code is flagged as unknown, an inactive agent is left out, and no alert is called out', () => {
  const r = build(base);
  assert.equal(r.findings.find((f) => f.kind === 'apex')!.billed, 'unknown');
  assert.equal(r.findings.filter((f) => f.kind === 'agent').length, 1);
  assert.equal(r.findings.find((f) => f.kind === 'agent')!.billed, 'yes', 'a service agent is metered');
  assert.match(r.findings.find((f) => f.kind === 'alerts')!.title, /No consumption threshold alert/);
  assert.match(r.findings.find((f) => f.kind === 'licence')!.title, /No Unmetered/);
});

test('markdown and html render every finding and the rates date, and html escapes', () => {
  const r = build({ ...base, org: { ...base.org, name: 'Acme <Test>' } });
  const md = markdown(r);
  for (const f of r.findings) assert.ok(md.includes(f.title));
  assert.match(md, /Rates as of 2026-04-21/);
  const h = html(r, 'https://acme.my.salesforce.com');
  assert.ok(h.includes('Acme &lt;Test&gt;') && !h.includes('Acme <Test>'));
  assert.ok(h.includes('/lightning/setup/DataStreams/home'));
});
