// Flows that call a prompt template, and the identity each run uses. Salesforce's rule (Metering for Agentforce and
// Generative AI Usage, read 14 Oct 2026): a prompt is unmetered only when it runs as the current user and that user
// holds the Unmetered User-Based AI licence. Scheduled flows, and the scheduled or asynchronous paths of record-triggered
// flows, run as the Automated Process User, so every prompt they call is metered by design.
import { query, type Session } from './salesforce.ts';

export interface FlowInfo {
  name: string;
  label: string;
  processType: string;
  triggerType: string | null; // RecordAfterSave, RecordBeforeSave, Scheduled, PlatformEvent, null
  object: string | null;
  when: string; // the entry condition in words: "a Lead is created or updated and Interview_Agent_Transcript__c changes"
  scheduledPaths: number; // record-triggered paths that run later, as the Automated Process User
  prompts: PromptAction[]; // prompt templates called, by API name, with what stands between the start and the call
}
export interface PromptAction { template: string; element: string; decisions: string[]; reachable: boolean }

export type RunsAs = 'automated process' | 'current user';
export interface PromptCall { flow: FlowInfo; template: string; runsAs: RunsAs; why: string; decisions: string[] }

// What the flow JSON from the Tooling API looks like, as far as we read it.
interface Connector { targetReference?: string }
interface Element { name?: string; label?: string; actionType?: string; actionName?: string; connector?: Connector; defaultConnector?: Connector; faultConnector?: Connector; nextValueConnector?: Connector; noMoreValuesConnector?: Connector; rules?: { name?: string; connector?: Connector }[] }
interface Filter { field?: string; operator?: string; value?: { stringValue?: string; booleanValue?: boolean; numberValue?: number; elementReference?: string } }
interface FlowMetadata { label?: string; processType?: string; start?: { triggerType?: string; object?: string; recordTriggerType?: string; filters?: Filter[]; filterLogic?: string; filterFormula?: string; doesRequireRecordChangedToMeetCriteria?: boolean; scheduledPaths?: unknown[]; connector?: Connector }; [kind: string]: unknown }
const ELEMENT_KINDS = ['actionCalls', 'decisions', 'assignments', 'recordLookups', 'recordUpdates', 'recordCreates', 'recordDeletes', 'subflows', 'loops', 'screens', 'waits', 'collectionProcessors', 'transforms', 'customErrors'];

const OPERATORS: Record<string, string> = { EqualTo: 'is', NotEqualTo: 'is not', IsChanged: 'changes', IsNull: 'is empty', Contains: 'contains', StartsWith: 'starts with', GreaterThan: 'is more than', LessThan: 'is less than', GreaterThanOrEqualTo: 'is at least', LessThanOrEqualTo: 'is at most', WasSet: 'is set' };
function filterText(f: Filter): string {
  const op = OPERATORS[f.operator ?? ''] ?? f.operator ?? '';
  if (f.operator === 'IsChanged' || f.operator === 'WasSet') return `${f.field} ${op}`;
  if (f.operator === 'IsNull') return f.value?.booleanValue === false ? `${f.field} is not empty` : `${f.field} is empty`;
  const v = f.value?.stringValue ?? f.value?.elementReference ?? (f.value?.booleanValue !== undefined ? String(f.value.booleanValue) : f.value?.numberValue !== undefined ? String(f.value.numberValue) : '');
  return `${f.field} ${op} ${v}`.trim();
}

// The entry condition, in words, so nobody reads "on Lead" as "on every Lead save".
export function whenText(md: FlowMetadata): string {
  const st = md.start ?? {};
  if (st.triggerType === 'Scheduled') return 'on its schedule';
  if (st.triggerType === 'PlatformEvent') return `a ${st.object ?? 'platform event'} message arrives`;
  if (!st.triggerType?.startsWith('Record')) return md.processType === 'Flow' ? 'someone runs the screen flow' : 'another flow, a process or code starts it';
  const verb = { Create: 'is created', Update: 'is updated', CreateAndUpdate: 'is created or updated', Delete: 'is deleted' }[st.recordTriggerType ?? ''] ?? 'is saved';
  const filters = (st.filters ?? []).map(filterText);
  const cond = st.filterFormula ? `the formula ${st.filterFormula} is true` : filters.length ? filters.join((st.filterLogic ?? 'and') === 'or' ? ' or ' : ' and ') : '';
  const changed = st.doesRequireRecordChangedToMeetCriteria ? ' (only when the record newly meets the condition)' : '';
  return `a ${st.object ?? 'record'} ${verb}${cond ? ` and ${cond}` : ''}${changed}`;
}

// Walks the connectors from the start to each prompt action. A prompt behind a decision runs only on that outcome;
// one on the straight path runs every time the flow does.
export function promptActions(md: FlowMetadata): PromptAction[] {
  const byName = new Map<string, Element>();
  for (const kind of ELEMENT_KINDS) for (const e of (md[kind] as Element[] | undefined) ?? []) if (e.name) byName.set(e.name, { ...e, kind } as Element);
  const outgoing = (e: Element) => [e.connector, e.defaultConnector, e.nextValueConnector, e.noMoreValuesConnector, ...(e.rules ?? []).map((r) => r.connector)].map((c) => c?.targetReference).filter((t): t is string => Boolean(t));
  // Breadth-first from the start, remembering the fewest decisions passed on the way to each element.
  const decisionsTo = new Map<string, string[]>();
  const first = md.start?.connector?.targetReference;
  const queue: { name: string; via: string[] }[] = first ? [{ name: first, via: [] }] : [];
  while (queue.length) {
    const { name, via } = queue.shift()!;
    if (decisionsTo.has(name)) continue;
    decisionsTo.set(name, via);
    const e = byName.get(name);
    if (!e) continue;
    const next = (e as Element & { kind?: string }).kind === 'decisions' ? [...via, e.label ?? name] : via;
    for (const t of outgoing(e)) queue.push({ name: t, via: next });
  }
  return ((md.actionCalls as Element[] | undefined) ?? [])
    .filter((a) => a.actionType === 'generatePromptResponse' && a.actionName && a.name)
    .map((a) => ({ template: a.actionName!, element: a.name!, decisions: decisionsTo.get(a.name!) ?? [], reachable: decisionsTo.has(a.name!) }));
}

export function fromMetadata(name: string, md: FlowMetadata): FlowInfo {
  return {
    name,
    label: md.label ?? name,
    processType: md.processType ?? '',
    triggerType: md.start?.triggerType ?? null,
    object: md.start?.object ?? null,
    when: whenText(md),
    scheduledPaths: md.start?.scheduledPaths?.length ?? 0,
    prompts: promptActions(md),
  };
}

// Which identity a prompt call runs under, per flow. One flow can produce calls under both, when it has an immediate
// path and a scheduled path; the metadata does not say which path holds the action, so both are reported.
export function promptCalls(flows: FlowInfo[]): PromptCall[] {
  const out: PromptCall[] = [];
  for (const flow of flows) {
    for (const p of flow.prompts) {
      if (!p.reachable) continue; // an action nothing connects to never runs
      const { template, decisions } = p;
      if (flow.triggerType === 'Scheduled') out.push({ flow, template, decisions, runsAs: 'automated process', why: 'a scheduled flow runs as the Automated Process User' });
      else if (flow.triggerType === 'PlatformEvent') out.push({ flow, template, decisions, runsAs: 'automated process', why: 'a platform event flow runs as the Automated Process User' });
      else if (flow.triggerType?.startsWith('Record')) {
        out.push({ flow, template, decisions, runsAs: 'current user', why: 'the immediate path of a record-triggered flow runs as the person who saved the record' });
        if (flow.scheduledPaths) out.push({ flow, template, decisions, runsAs: 'automated process', why: `${flow.scheduledPaths} scheduled or asynchronous path${flow.scheduledPaths === 1 ? '' : 's'} run as the Automated Process User` });
      } else out.push({ flow, template, decisions, runsAs: 'current user', why: 'a screen or autolaunched flow runs as the person or process that starts it' });
    }
  }
  return out;
}

// Active flows only: an inactive version cannot spend anything. One Tooling call per flow, which the API requires.
export async function readFlows(s: Session, onProgress?: (done: number, total: number) => void): Promise<FlowInfo[]> {
  const defs = await query<{ DeveloperName: string; ActiveVersionId: string }>(s, "SELECT DeveloperName, ActiveVersionId FROM FlowDefinition WHERE ActiveVersionId != null", true);
  const out: FlowInfo[] = [];
  for (const [i, d] of defs.entries()) {
    const [row] = await query<{ Metadata: FlowMetadata }>(s, `SELECT Metadata FROM Flow WHERE Id = '${d.ActiveVersionId}'`, true);
    if (row) out.push(fromMetadata(d.DeveloperName, row.Metadata));
    onProgress?.(i + 1, defs.length);
  }
  return out;
}
