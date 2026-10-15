// Consumption threshold alerts. They notify; they never stop spend. Zero rows means nobody has even asked to be told.
import { optional, query, type Session } from './salesforce.ts';

export interface Alert { name: string; type: string; scope: string; trigger: string; status: string; notifies: boolean }

export async function readAlerts(s: Session): Promise<Alert[]> {
  const rows = await optional(() => query<any>(s, 'SELECT Name, AlertType, AlertScope, TriggerType, TriggerValue, AlertStatus, IsNotificationSent FROM TenantConsumptionAlert'), [] as any[]);
  return rows.map((r) => ({ name: r.Name, type: r.AlertType ?? '', scope: r.AlertScope ?? '', trigger: `${r.TriggerType ?? ''} ${r.TriggerValue ?? ''}`.trim(), status: r.AlertStatus ?? '', notifies: Boolean(r.IsNotificationSent) }));
}
