import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiCallsIn, runsPerMonthFromCron } from '../src/apex.ts';

test('the AI entry points are found in Apex, and ordinary code is left alone', () => {
  assert.deepEqual(aiCallsIn("ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate('Summarise_Case', input);"), ['ConnectApi.EinsteinLLM (prompt templates and LLM calls)']);
  assert.deepEqual(aiCallsIn('aiplatform.ModelsAPI api = new aiplatform.ModelsAPI();'), ['aiplatform.ModelsAPI (Models API)']);
  assert.deepEqual(aiCallsIn("Invocable.Action a = Invocable.Action.createCustomAction('generatePromptResponse', 'Interview_Score');"), ['generatePromptResponse (prompt template action)']);
  assert.deepEqual(aiCallsIn('Database.executeBatch(new NightlyCleanup(), 200);'), []);
});

test('cron expressions turn into runs a month, roughly', () => {
  assert.equal(runsPerMonthFromCron('0 0 2 * * ?'), 30, 'daily at 2am');
  assert.equal(runsPerMonthFromCron('0 0 * * * ?'), 720, 'hourly');
  assert.equal(runsPerMonthFromCron('0 0 */6 * * ?'), 120, 'every six hours');
  assert.equal(runsPerMonthFromCron('0 0 6,18 ? * MON-FRI'), 2 * 21, 'twice a day on weekdays');
  assert.equal(runsPerMonthFromCron('0 0 0 1 * ?'), 1, 'first of the month');
  assert.equal(runsPerMonthFromCron('0 0 0 L * ?'), 1, 'last day of the month');
  assert.equal(runsPerMonthFromCron('nonsense'), null);
});
