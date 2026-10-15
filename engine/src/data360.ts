// Data 360 work that spends Flex Credits by design: every stream refresh and transform run processes rows, and the
// rate card prices rows processed (Data 360 Prep: 40 credits per million rows in production, 32 in a sandbox, 21 Apr
// 2026). All of it is readable with plain SOQL on setup objects, checked on the Lakewood partial sandbox, 15 Oct 2026.
import { optional, query, type Session } from './salesforce.ts';

export interface Stream {
  name: string;
  status: string; // ACTIVE, INACTIVE
  frequency: string; // HOURLY, BATCH (scheduled), NONE
  hours: number | null; // runs per day for a BATCH schedule, when set
  mode: string; // FULL, INCREMENTAL, UPSERT
  fullRefreshEveryDays: string | null; // an UPSERT stream can still do a full refresh every N days
  lastRun: string | null;
  rowsLastRun: number;
  rowsTotal: number;
  lakeObject: string | null;
}
export interface LakeObject { name: string; records: number; lastRefresh: string | null }
export interface Transform { name: string; type: string; status: string; frequency: string | null; lastRun: string | null; lastRunStatus: string | null }
export interface Insight { name: string; status: string; lastRun: string | null }
export interface Data360 { streams: Stream[]; lakeObjects: LakeObject[]; transforms: Transform[]; insights: Insight[] }

// Orgs without Data 360 have none of these objects; that reads as no streams, which is the truth.
export async function readData360(s: Session): Promise<Data360> {
  const none: any[] = [];
  const [streams, lakes, transforms, insights] = await Promise.all([
    optional(() => query<any>(s, 'SELECT Name, DataStreamStatus, RefreshFrequency, RefreshHours, RefreshMode, FullRefreshIntervalDays, LastRefreshDate, LastNumberOfRowsAddedCount, TotalNumberOfRowsAdded, TotalRowsProcessed FROM DataStream'), none),
    optional(() => query<any>(s, 'SELECT Id, Name, TotalRecords, LastRefreshDate FROM DataLakeObjectInstance'), none),
    optional(() => query<any>(s, 'SELECT Name, Type, DataTransformStatus, FullRunFrequency, LastRunTime, LastRunStatus FROM MktDataTransform'), none),
    optional(() => query<any>(s, 'SELECT Name, CalculatedInsightStatus, LastRunDateTime FROM MktCalculatedInsight'), none),
  ]);
  // DataStream has no link to its lake object; the names match once the usual Stream suffix is dropped.
  const lakeFor = (name: string) => lakes.find((l) => l.Name === name || l.Name === name.replace(/Stream$/, ''))?.Name ?? null;
  return {
    streams: streams.map((r) => ({
      name: r.Name, status: r.DataStreamStatus ?? '', frequency: r.RefreshFrequency ?? 'NONE', hours: r.RefreshHours == null ? null : Number(r.RefreshHours), mode: r.RefreshMode ?? '',
      fullRefreshEveryDays: r.FullRefreshIntervalDays && r.FullRefreshIntervalDays !== 'NONE' ? r.FullRefreshIntervalDays : null,
      lastRun: r.LastRefreshDate ?? null, rowsLastRun: r.LastNumberOfRowsAddedCount ?? 0, rowsTotal: r.TotalNumberOfRowsAdded ?? r.TotalRowsProcessed ?? 0, lakeObject: lakeFor(r.Name),
    })),
    lakeObjects: lakes.map((l) => ({ name: l.Name, records: l.TotalRecords ?? 0, lastRefresh: l.LastRefreshDate ?? null })),
    transforms: transforms.map((t) => ({ name: t.Name, type: t.Type ?? '', status: t.DataTransformStatus ?? '', frequency: t.FullRunFrequency ?? null, lastRun: t.LastRunTime ?? null, lastRunStatus: t.LastRunStatus ?? null })),
    insights: insights.map((i) => ({ name: i.Name, status: i.CalculatedInsightStatus ?? '', lastRun: i.LastRunDateTime ?? null })),
  };
}

// Rows a stream will process in a month, from its schedule and mode. Full refreshes reprocess the whole lake object;
// incremental ones only what changed, so the last run is the best guide. Both numbers are estimates and are labelled so.
export const PREP_CREDITS_PER_MILLION = { production: 40, sandbox: 32 }; // Flex Credits Rate Card, 21 Apr 2026, base tier
export function runsPerMonth(st: Stream): number {
  if (st.status !== 'ACTIVE') return 0;
  if (st.frequency === 'HOURLY') return 24 * 30;
  if (st.frequency === 'BATCH') return (st.hours ?? 1) * 30;
  return 0;
}
export function rowsPerMonth(st: Stream, lake: LakeObject | undefined): { low: number; high: number } {
  const runs = runsPerMonth(st);
  if (!runs) return { low: 0, high: 0 };
  const full = lake?.records ?? st.rowsTotal;
  if (st.mode === 'FULL') return { low: runs * full, high: runs * full };
  // "DAYS_25" means a full refresh every 25 days: 1.2 of them in a 30-day month.
  const fulls = st.fullRefreshEveryDays ? 30 / (Number(st.fullRefreshEveryDays.replace(/\D/g, '')) || 30) : 0;
  return { low: Math.round(runs * st.rowsLastRun + fulls * full), high: Math.round(runs * Math.max(st.rowsLastRun, 1) + fulls * full) };
}
export const credits = (rows: number, sandbox: boolean) => Math.ceil((rows / 1_000_000) * PREP_CREDITS_PER_MILLION[sandbox ? 'sandbox' : 'production']);
