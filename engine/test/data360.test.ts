import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runsPerMonth, rowsPerMonth, credits, type Stream } from '../src/data360.ts';

const base: Stream = { name: 'S', status: 'ACTIVE', frequency: 'BATCH', hours: 1, mode: 'UPSERT', fullRefreshEveryDays: null, lastRun: null, rowsLastRun: 500, rowsTotal: 20000, lakeObject: 'S__dll' };

test('an inactive stream processes nothing; hourly and daily schedules count their runs', () => {
  assert.equal(runsPerMonth({ ...base, status: 'INACTIVE' }), 0);
  assert.equal(runsPerMonth({ ...base, frequency: 'HOURLY' }), 720);
  assert.equal(runsPerMonth(base), 30);
  assert.equal(runsPerMonth({ ...base, frequency: 'NONE' }), 0);
});

test('a full-refresh stream reprocesses every row of its lake object on each run', () => {
  const lake = { name: 'S__dll', records: 2_000_000, lastRefresh: null };
  assert.deepEqual(rowsPerMonth({ ...base, mode: 'FULL' }, lake), { low: 60_000_000, high: 60_000_000 });
  assert.equal(credits(60_000_000, false), 2400, '60 million rows at 40 credits per million');
  assert.equal(credits(60_000_000, true), 1920, 'sandbox rate');
});

test('an incremental stream counts the rows it last added, plus any periodic full refresh', () => {
  const lake = { name: 'S__dll', records: 2_000_000, lastRefresh: null };
  assert.deepEqual(rowsPerMonth(base, lake), { low: 15_000, high: 15_000 });
  assert.deepEqual(rowsPerMonth({ ...base, fullRefreshEveryDays: 'DAYS_25' }, lake), { low: 2_415_000, high: 2_415_000 }, '1.2 full refreshes in a 30-day month');
  assert.deepEqual(rowsPerMonth({ ...base, rowsLastRun: 0 }, lake), { low: 0, high: 30 }, 'a quiet stream still runs');
});
