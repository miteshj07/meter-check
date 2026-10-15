import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMetadata, promptCalls, whenText, promptActions } from '../src/flows.ts';

const prompt = { name: 'P1', actionType: 'generatePromptResponse', actionName: 'Summarise_Case', connector: { targetReference: 'Done' } };
const email = { name: 'E1', actionType: 'emailSimple', actionName: 'Notify' };
const go = (first: string) => ({ connector: { targetReference: first } });

test('a scheduled flow calling a prompt is metered by design; a screen flow depends on the user', () => {
  const flows = [
    fromMetadata('Nightly', { label: 'Nightly summaries', processType: 'AutoLaunchedFlow', start: { triggerType: 'Scheduled', ...go('P1') }, actionCalls: [prompt] }),
    fromMetadata('Helper', { processType: 'Flow', start: go('P1'), actionCalls: [prompt, email] }),
    fromMetadata('Plain', { processType: 'AutoLaunchedFlow', actionCalls: [email] }),
  ];
  const calls = promptCalls(flows);
  assert.deepEqual(calls.map((c) => [c.flow.name, c.template, c.runsAs]), [['Nightly', 'Summarise_Case', 'automated process'], ['Helper', 'Summarise_Case', 'current user']]);
  assert.equal(flows[2].prompts.length, 0, 'an email action is not a prompt');
});

test('a record-triggered flow with a scheduled path is reported under both identities', () => {
  const [f] = [fromMetadata('OnCase', { start: { triggerType: 'RecordAfterSave', object: 'Case', scheduledPaths: [{}, {}], ...go('P1') }, actionCalls: [prompt] })];
  const calls = promptCalls([f]);
  assert.deepEqual(calls.map((c) => c.runsAs), ['current user', 'automated process']);
  assert.match(calls[1].why, /2 scheduled or asynchronous paths/);
  assert.equal(f.object, 'Case');
});

test('a record-triggered flow with only an immediate path runs as the person who saved', () => {
  const calls = promptCalls([fromMetadata('OnLead', { start: { triggerType: 'RecordBeforeSave', object: 'Lead', ...go('P1') }, actionCalls: [prompt] })]);
  assert.deepEqual(calls.map((c) => c.runsAs), ['current user']);
});

// The Lakewood flow as read on 15 Oct 2026: Lead created or updated, only when the transcript field changes,
// two prompts on the straight path, no decisions.
test('the entry condition is spelled out and prompts on the straight path run every time', () => {
  const md = {
    label: 'Interview Summary & Score', processType: 'AutoLaunchedFlow',
    start: { triggerType: 'RecordAfterSave', object: 'Lead', recordTriggerType: 'CreateAndUpdate', filterLogic: 'and', filters: [{ field: 'Interview_Agent_Transcript__c', operator: 'IsChanged', value: { booleanValue: true } }], connector: { targetReference: 'Interview_Score' } },
    actionCalls: [
      { name: 'Interview_Score', actionType: 'generatePromptResponse', actionName: 'Interview_Score', connector: { targetReference: 'Interview_Summary' } },
      { name: 'Interview_Summary', actionType: 'generatePromptResponse', actionName: 'Interview_Summary', connector: { targetReference: 'Update_Score_Summary' } },
    ],
    recordUpdates: [{ name: 'Update_Score_Summary' }],
  };
  assert.equal(whenText(md), 'a Lead is created or updated and Interview_Agent_Transcript__c changes');
  assert.deepEqual(promptActions(md).map((p) => [p.template, p.decisions, p.reachable]), [['Interview_Score', [], true], ['Interview_Summary', [], true]]);
});

test('a prompt behind a decision names the decision; one nothing connects to is ignored', () => {
  const md = {
    start: { triggerType: 'RecordAfterSave', object: 'Case', recordTriggerType: 'Update', filterFormula: '{!$Record.Priority} = "High"', doesRequireRecordChangedToMeetCriteria: true, connector: { targetReference: 'Is_Escalated' } },
    decisions: [{ name: 'Is_Escalated', label: 'Is it escalated?', rules: [{ name: 'Yes', connector: { targetReference: 'Summarise' } }], defaultConnector: { targetReference: 'Close' } }],
    actionCalls: [
      { name: 'Summarise', actionType: 'generatePromptResponse', actionName: 'Summarise_Case' },
      { name: 'Orphan', actionType: 'generatePromptResponse', actionName: 'Never_Runs' },
    ],
    recordUpdates: [{ name: 'Close' }],
  };
  assert.equal(whenText(md), 'a Case is updated and the formula {!$Record.Priority} = "High" is true (only when the record newly meets the condition)');
  const calls = promptCalls([fromMetadata('Esc', md)]);
  assert.deepEqual(calls.map((c) => [c.template, c.decisions]), [['Summarise_Case', ['Is it escalated?']]], 'the orphan is not reported');
});
