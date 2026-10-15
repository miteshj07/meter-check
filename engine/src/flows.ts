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
  scheduledPaths: number; // record-triggered paths that run later, as the Automated Process User
  prompts: string[]; // prompt templates called, by API name
}

export type RunsAs = 'automated process' | 'current user';
export interface PromptCall { flow: FlowInfo; template: string; runsAs: RunsAs; why: string }

// What the flow JSON from the Tooling API looks like, as far as we read it.
interface FlowMetadata { label?: string; processType?: string; start?: { triggerType?: string; object?: string; scheduledPaths?: unknown[] }; actionCalls?: { actionType?: string; actionName?: string }[] }

export function fromMetadata(name: string, md: FlowMetadata): FlowInfo {
  return {
    name,
    label: md.label ?? name,
    processType: md.processType ?? '',
    triggerType: md.start?.triggerType ?? null,
    object: md.start?.object ?? null,
    scheduledPaths: md.start?.scheduledPaths?.length ?? 0,
    prompts: (md.actionCalls ?? []).filter((a) => a.actionType === 'generatePromptResponse' && a.actionName).map((a) => a.actionName!),
  };
}

// Which identity a prompt call runs under, per flow. One flow can produce calls under both, when it has an immediate
// path and a scheduled path; the metadata does not say which path holds the action, so both are reported.
export function promptCalls(flows: FlowInfo[]): PromptCall[] {
  const out: PromptCall[] = [];
  for (const flow of flows) {
    for (const template of flow.prompts) {
      if (flow.triggerType === 'Scheduled') out.push({ flow, template, runsAs: 'automated process', why: 'a scheduled flow runs as the Automated Process User' });
      else if (flow.triggerType === 'PlatformEvent') out.push({ flow, template, runsAs: 'automated process', why: 'a platform event flow runs as the Automated Process User' });
      else if (flow.triggerType?.startsWith('Record')) {
        out.push({ flow, template, runsAs: 'current user', why: 'the immediate path of a record-triggered flow runs as the person who saved the record' });
        if (flow.scheduledPaths) out.push({ flow, template, runsAs: 'automated process', why: `${flow.scheduledPaths} scheduled or asynchronous path${flow.scheduledPaths === 1 ? '' : 's'} run as the Automated Process User` });
      } else out.push({ flow, template, runsAs: 'current user', why: 'a screen or autolaunched flow runs as the person or process that starts it' });
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
