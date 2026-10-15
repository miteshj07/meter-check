// The Unmetered User Based AI licence (Configure User Permissions for Unmetered Licenses, read 14 Oct 2026). Without it,
// nothing in the org is unmetered, whoever runs it.
import { query, type Session } from './salesforce.ts';

export interface Unmetered { exists: boolean; total: number; assigned: number; developerName: string | null }

export async function readUnmetered(s: Session): Promise<Unmetered> {
  const rows = await query<{ DeveloperName: string; MasterLabel: string; TotalLicenses: number; UsedLicenses: number }>(s, "SELECT DeveloperName, MasterLabel, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE MasterLabel LIKE '%Unmetered%'");
  const l = rows.find((r) => /user.?based/i.test(r.MasterLabel)) ?? rows[0];
  return l ? { exists: true, total: l.TotalLicenses, assigned: l.UsedLicenses, developerName: l.DeveloperName } : { exists: false, total: 0, assigned: 0, developerName: null };
}
