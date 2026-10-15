// Agents, and which of their actions are metered. The rate card prices every Agentforce action at 20 credits in
// production and 16 in a sandbox (21 Apr 2026). Salesforce's metering table lists only Employee Agents, Sales Coach and
// Service Rep Assistant as eligible for unmetering, and only for licensed users acting as themselves; a service agent
// serving customers, or any agent run on a schedule, is metered every time.
import { optional, query, type Session } from './salesforce.ts';

export interface Agent { name: string; label: string; type: string; active: boolean; activeVersion: number | null; versions: number }
export const ACTION_CREDITS = { production: 20, sandbox: 16 };

export type Billing = 'metered' | 'unmetered if the user is licensed' | 'not running';
export function billing(a: Agent): Billing {
  if (!a.active) return 'not running';
  return /Employee|Copilot|SalesCoach|ServiceRep|Default/i.test(a.type) ? 'unmetered if the user is licensed' : 'metered';
}
// The Agentforce (Default) agent, which Coworker builds on: once Coworker is on, global search is billed through it.
export const isDefaultAgent = (a: Agent) => /Copilot|Default/i.test(a.name) || /Copilot/i.test(a.type);

// Orgs without agents have no BotDefinition object at all, which is the same answer as no agents.
export async function readAgents(s: Session): Promise<Agent[]> {
  const defs = await optional(() => query<any>(s, 'SELECT Id, DeveloperName, MasterLabel, AgentType FROM BotDefinition WHERE IsDeleted = false'), [] as any[]);
  if (!defs.length) return [];
  const versions = await optional(() => query<any>(s, 'SELECT BotDefinitionId, Status, VersionNumber FROM BotVersion'), [] as any[]);
  return defs.map((d) => {
    const mine = versions.filter((v) => v.BotDefinitionId === d.Id);
    const active = mine.find((v) => v.Status === 'Active');
    return { name: d.DeveloperName, label: d.MasterLabel, type: d.AgentType ?? '', active: Boolean(active), activeVersion: active ? Number(active.VersionNumber) : null, versions: mine.length };
  });
}
