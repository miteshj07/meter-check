import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billing, isDefaultAgent, type Agent } from '../src/agents.ts';

const agent = (over: Partial<Agent>): Agent => ({ name: 'A', label: 'A', type: 'AgentforceServiceAgent', active: true, activeVersion: 1, versions: 1, ...over });

test('a service agent is metered; an employee agent can be unmetered for licensed users; an inactive one costs nothing', () => {
  assert.equal(billing(agent({})), 'metered');
  assert.equal(billing(agent({ type: 'AgentforceEmployeeAgent' })), 'unmetered if the user is licensed');
  assert.equal(billing(agent({ type: 'EinsteinCopilot' })), 'unmetered if the user is licensed');
  assert.equal(billing(agent({ active: false, activeVersion: null })), 'not running');
});

test('the default agent is recognised by name or type', () => {
  assert.equal(isDefaultAgent(agent({ name: 'Copilot_for_Salesforce', type: 'EinsteinCopilot' })), true);
  assert.equal(isDefaultAgent(agent({ name: 'Deal_Risk_Agent', type: 'AgentforceEmployeeAgent' })), false);
});
