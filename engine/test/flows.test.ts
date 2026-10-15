import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMetadata, promptCalls } from '../src/flows.ts';

const prompt = { actionType: 'generatePromptResponse', actionName: 'Summarise_Case' };
const email = { actionType: 'emailSimple', actionName: 'Notify' };

test('a scheduled flow calling a prompt is metered by design; a screen flow depends on the user', () => {
  const flows = [
    fromMetadata('Nightly', { label: 'Nightly summaries', processType: 'AutoLaunchedFlow', start: { triggerType: 'Scheduled' }, actionCalls: [prompt] }),
    fromMetadata('Helper', { processType: 'Flow', actionCalls: [prompt, email] }),
    fromMetadata('Plain', { processType: 'AutoLaunchedFlow', actionCalls: [email] }),
  ];
  const calls = promptCalls(flows);
  assert.deepEqual(calls.map((c) => [c.flow.name, c.template, c.runsAs]), [['Nightly', 'Summarise_Case', 'automated process'], ['Helper', 'Summarise_Case', 'current user']]);
  assert.equal(flows[2].prompts.length, 0, 'an email action is not a prompt');
});

test('a record-triggered flow with a scheduled path is reported under both identities', () => {
  const [f] = [fromMetadata('OnCase', { start: { triggerType: 'RecordAfterSave', object: 'Case', scheduledPaths: [{}, {}] }, actionCalls: [prompt] })];
  const calls = promptCalls([f]);
  assert.deepEqual(calls.map((c) => c.runsAs), ['current user', 'automated process']);
  assert.match(calls[1].why, /2 scheduled or asynchronous paths/);
  assert.equal(f.object, 'Case');
});

test('a record-triggered flow with only an immediate path runs as the person who saved', () => {
  const calls = promptCalls([fromMetadata('OnLead', { start: { triggerType: 'RecordBeforeSave', object: 'Lead' }, actionCalls: [prompt] })]);
  assert.deepEqual(calls.map((c) => c.runsAs), ['current user']);
});
