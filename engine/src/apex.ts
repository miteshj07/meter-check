// Scheduled Apex that calls generative AI. Salesforce's rule: scheduled Apex and batch jobs run in the background, so
// every AI call they make is metered. We find the scheduled classes, read their code and the code they call one level
// down, and look for the AI APIs. Managed-package code is hidden from the API and is reported as such.
import { query, type Session } from './salesforce.ts';

export interface ScheduledJob {
  job: string; // the schedule's name in Setup, Scheduled Jobs
  className: string;
  namespace: string | null; // a packaged class, whose code we cannot read
  cron: string | null;
  runsPerMonth: number | null; // from the cron expression; null when it cannot be read
  nextRun: string | null;
  aiCalls: { className: string; apis: string[] }[]; // the scheduled class and the classes it uses, where AI is called
  hidden: string[]; // packaged classes on the path whose code is not readable
}

// The Apex entry points to generative AI, by the names that appear in code.
const AI_APIS: [RegExp, string][] = [
  [/ConnectApi\.EinsteinLLM/i, 'ConnectApi.EinsteinLLM (prompt templates and LLM calls)'],
  [/aiplatform\.ModelsAPI/i, 'aiplatform.ModelsAPI (Models API)'],
  [/generatePromptResponse/i, 'generatePromptResponse (prompt template action)'],
  [/ConnectApi\.(EinsteinPromptTemplate|PromptTemplate)/i, 'ConnectApi prompt template API'],
  [/ConnectApi\.Agentforce|AgentforceAPI|aiplatform\.Agent/i, 'Agentforce agent API'],
];
export function aiCallsIn(body: string): string[] {
  return AI_APIS.filter(([re]) => re.test(body)).map(([, label]) => label);
}

// Runs per 30-day month from a Salesforce cron expression (seconds minutes hours day-of-month month day-of-week year).
// Rough on purpose: enough to tell "every hour" from "first of the month".
export function runsPerMonthFromCron(cron: string): number | null {
  const f = cron.trim().split(/\s+/);
  if (f.length < 6) return null;
  const NAMES: Record<string, number> = { SUN: 1, MON: 2, TUE: 3, WED: 4, THU: 5, FRI: 6, SAT: 7, JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const count = (raw: string, span: number): number => {
    const field = raw.toUpperCase().replace(/[A-Z]{3}/g, (m) => String(NAMES[m] ?? m));
    if (field === '*' || field === '?') return span;
    const step = /^\*\/(\d+)$/.exec(field);
    if (step) return Math.max(1, Math.floor(span / Number(step[1])));
    const range = /^(\d+)-(\d+)$/.exec(field);
    if (range) return Number(range[2]) - Number(range[1]) + 1;
    if (/^[\d,]+$/.test(field)) return field.split(',').length;
    return 1; // L, W, # and names: once per period is the safest reading
  };
  const minutesPerHour = count(f[1], 60);
  const hoursPerDay = count(f[2], 24);
  const dom = f[3], dow = f[5];
  const daysPerMonth = dom !== '*' && dom !== '?' ? count(dom, 30) : dow !== '*' && dow !== '?' ? Math.round(count(dow, 7) * 30 / 7) : 30;
  return minutesPerHour * hoursPerDay * daysPerMonth;
}

const word = (name: string) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

export async function readScheduledApex(s: Session): Promise<ScheduledJob[]> {
  const jobs = await query<any>(s, "SELECT ApexClassId, ApexClass.Name, ApexClass.NamespacePrefix, CronTriggerId FROM AsyncApexJob WHERE JobType = 'ScheduledApex' AND Status = 'Queued'");
  if (!jobs.length) return [];
  const cronIds = [...new Set(jobs.map((j) => j.CronTriggerId).filter(Boolean))];
  const crons = cronIds.length ? await query<any>(s, `SELECT Id, CronExpression, NextFireTime, CronJobDetail.Name FROM CronTrigger WHERE Id IN (${cronIds.map((i) => `'${i}'`).join(',')})`) : [];
  const cronById = new Map(crons.map((c) => [c.Id, c]));
  // Every class name in the org, so we can see which ones a scheduled class hands work to.
  const all = await query<{ Id: string; Name: string; NamespacePrefix: string | null }>(s, 'SELECT Id, Name, NamespacePrefix FROM ApexClass');
  const bodies = new Map<string, string>();
  const body = async (id: string) => {
    if (!bodies.has(id)) {
      const [row] = await query<{ Body: string | null }>(s, `SELECT Body FROM ApexClass WHERE Id = '${id}'`);
      bodies.set(id, row?.Body ?? '');
    }
    return bodies.get(id)!;
  };
  const out: ScheduledJob[] = [];
  for (const j of jobs) {
    const cron = cronById.get(j.CronTriggerId);
    const job: ScheduledJob = { job: cron?.CronJobDetail?.Name ?? j.ApexClass?.Name ?? 'Scheduled job', className: j.ApexClass?.Name ?? '', namespace: j.ApexClass?.NamespacePrefix ?? null, cron: cron?.CronExpression ?? null, runsPerMonth: cron?.CronExpression ? runsPerMonthFromCron(cron.CronExpression) : null, nextRun: cron?.NextFireTime ?? null, aiCalls: [], hidden: [] };
    const seen = new Set<string>();
    const visit = async (id: string, name: string, ns: string | null, depth: number) => {
      if (seen.has(id) || depth > 1) return;
      seen.add(id);
      const code = await body(id);
      if (!code || code === '(hidden)') { job.hidden.push(ns ? `${ns}.${name}` : name); return; }
      const apis = aiCallsIn(code);
      if (apis.length) job.aiCalls.push({ className: name, apis });
      // One level down: the classes this one names. Capped so a god class cannot cost hundreds of reads.
      const used = all.filter((c) => c.Id !== id && word(c.Name).test(code)).slice(0, 20);
      for (const c of used) await visit(c.Id, c.Name, c.NamespacePrefix, depth + 1);
    };
    if (j.ApexClassId) await visit(j.ApexClassId, j.ApexClass?.Name ?? '', j.ApexClass?.NamespacePrefix ?? null, 0);
    out.push(job);
  }
  return out;
}
