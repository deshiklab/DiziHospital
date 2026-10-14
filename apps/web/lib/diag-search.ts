/* -----------------------------------------------------------------------------
 * Pathology and radiology search — legacy screens 014 and 015, which were two screens for one question:
 * “what did this patient’s tests say, and what did they say last time?”
 *
 * The rules that make the search worth having:
 *
 *  - **A result is searchable only when it is verified.** A value entered an hour ago by a technician is not a
 *    result, and a search that shows it beside verified ones will eventually be read as one.
 *  - **A trend compares like with like.** Same analyte, same units, same laboratory. Two numbers from different
 *    methods on one graph is how a stable patient looks like they deteriorated.
 *  - **A critical result is a telephone call.** The screen shows which critical results are still uncalled, and
 *    records the call — because a panic value that nobody acted on is the failure mode this whole module exists
 *    to prevent.
 *  - **A corrected result supersedes, it does not overwrite.** The old value stays visible with the correction
 *    beside it; a doctor who acted on the first number needs to be able to see what they acted on.
 *  - **Imaging is searched by what was asked, not by the images.** The report, the modality and the indication are
 *    the searchable content; the images live in the PACS and are linked, never copied.
 *
 * Preview: the results come from the same generator the worklist uses. Nothing survives a reload; the rules do.
 */

import {
  TESTS,
  flagLabel,
  flagTone,
  flagValue,
  generateDiagnosticOrders,
  isCritical,
  needsCallback,
  tatStatus,
  type Analyte,
  type DiagnosticOrder,
  type LabTest,
   type ResultFlag,
} from './diagnostics';
import { patients } from './mock';

export interface ResultRow {
  order: DiagnosticOrder;
  test: LabTest;
  flag: ResultFlag;
  critical: boolean;
  /** The value as printed, with units: what a trend is compared on. */
  values: Array<{ analyte: Analyte; value: number | string; flag: ResultFlag; text: string }>;
  /** The previous verified result for the same test, for the comparison column. */
  previous?: { at: string; orderId: string; values: Record<string, number | string> };
  trend: Array<{ at: string; value: number }>;
  called?: { at: string; to: string; by: string };
}

/** How far back the comparison reaches when a patient's history is assembled. */
export const TREND_DAYS = 120;

const shiftDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export interface SearchFilters {
  query: string;
  kind: 'all' | 'lab' | 'imaging';
  patient?: string;
  from: string;
  to: string;
  criticalOnly: boolean;
  uncalledOnly: boolean;
  status: 'all' | 'verified' | 'inProgress';
  includeUnverified: boolean;
}

/** The day's orders plus the seeded history, so a search has a trend to show rather than one point. */
export function resultPool(dayIso: string): ResultRow[] {
  const days = [0, 3, 11, 26, 47, 73, 96].map((ago) => shiftDays(dayIso, -ago));
  const rows: ResultRow[] = [];

  days.forEach((day, dayIndex) => {
    generateDiagnosticOrders(day).forEach((order) => {
      const test = TESTS.find((t) => t.code === order.testCode);
      if (!test) return;
      const values = test.analytes.map((analyte) => {
        const value = order.results[analyte.key];
        if (value === undefined) return null;
        const f = typeof value === 'number' ? flagValue(analyte, value) : 'text';
        return {
          analyte,
          value,
          flag: f,
          text: typeof value === 'number' ? `${value} ${analyte.unit} — ${flagLabel[f].toLowerCase()}` : String(value),
        };
      }).filter(Boolean) as ResultRow['values'];
      const flag = values.reduce<ResultFlag>((worst, v) => worse(v.flag, worst), 'ok');

      rows.push({
        order,
        test,
        flag,
        critical: values.some((v) => isCritical(v.flag)),
        values,
        trend: [],
        // A critical result on the most recent day is deliberately still uncalled: the screen's job is to show
        // somebody that the phone call has not happened yet.
        ...(dayIndex > 0 && order.status === 'Verified' && values.some((v) => isCritical(v.flag))
          ? { called: { at: `${day}T${String(9 + (dayIndex % 6)).padStart(2, '0')}:15`, to: 'The ward', by: 'Laboratory in-charge' } }
          : {}),
      });
    });
  });

  // Attach the previous verified result and build the trend, per patient and per test.
  const byKey = new Map<string, ResultRow[]>();
  rows.forEach((r) => {
    const key = `${r.order.patient.mrn}|${r.test.code}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  });
  byKey.forEach((group) => {
    const ordered = [...group].sort((a, b) => a.order.orderedAt.localeCompare(b.order.orderedAt));
    ordered.forEach((row, i) => {
      const prev = ordered.slice(0, i).filter((p) => p.order.status === 'Verified').at(-1);
      if (prev) {
        row.previous = { at: prev.order.resultedAt ?? prev.order.orderedAt, orderId: prev.order.id, values: prev.order.results };
      }
      const analyte = row.test.analytes[0];
      if (analyte) {
        const series = ordered
          .filter((p) => p.order.status === 'Verified' && typeof p.order.results[analyte.key] === 'number')
          .map((p) => ({ at: p.order.resultedAt ?? p.order.orderedAt, value: p.order.results[analyte.key] as number }));
        row.trend = series;
      }
    });
  });

  return rows;
}

const RANK: Record<ResultFlag, number> = { 'critical-high': 4, 'critical-low': 4, high: 3, low: 3, ok: 1, text: 0 };
const worse = (a: ResultFlag, b: ResultFlag): ResultFlag => (RANK[a] >= RANK[b] ? a : b);

/** The search. Everything is optional except the window, which is why it is on the screen and not in a menu. */
export function searchResults(dayIso: string, filters: SearchFilters, pool = resultPool(dayIso)): ResultRow[] {
  const q = filters.query.trim().toLowerCase();
  return pool
    .filter((r) => {
      const day = r.order.orderedAt.slice(0, 10);
      if (day < filters.from || day > filters.to) return false;
      if (filters.kind !== 'all' && r.order.kind !== filters.kind) return false;
      if (filters.patient && r.order.patient.mrn !== filters.patient) return false;
      if (filters.criticalOnly && !r.critical) return false;
      if (filters.uncalledOnly && !(needsCallback(r.order) && !r.called)) return false;
      if (filters.status === 'verified' && r.order.status !== 'Verified') return false;
      if (filters.status === 'inProgress' && r.order.status === 'Verified') return false;
      if (!filters.includeUnverified && r.order.status !== 'Verified' && !filters.uncalledOnly) return false;
      if (q) {
        const haystack = [r.order.testName, r.test.code, r.order.patient.name, r.order.patient.mrn, r.order.report ?? '', r.test.modality ?? '', r.test.sample ?? ''].join(' ').toLowerCase();
        if (!q.split(/\s+/).every((t) => haystack.includes(t))) return false;
      }
      return true;
    })
    .sort((a, b) => b.order.orderedAt.localeCompare(a.order.orderedAt));
}

export interface ResultStats {
  total: number;
  verified: number;
  inProgress: number;
  critical: number;
  uncalled: number;
  patients: number;
  labs: number;
  imaging: number;
  averageTatHours: number;
}

export function resultStats(rows: ResultRow[]): ResultStats {
  const withBoth = rows.filter((r) => r.order.collectedAt && r.order.resultedAt);
  const tat = withBoth.map((r) => (new Date(r.order.resultedAt!).getTime() - new Date(r.order.collectedAt!).getTime()) / 3_600_000);
  return {
    total: rows.length,
    verified: rows.filter((r) => r.order.status === 'Verified').length,
    inProgress: rows.filter((r) => r.order.status !== 'Verified').length,
    critical: rows.filter((r) => r.critical).length,
    uncalled: rows.filter((r) => needsCallback(r.order)).length,
    patients: new Set(rows.map((r) => r.order.patient.mrn)).size,
    labs: rows.filter((r) => r.order.kind === 'lab').length,
    imaging: rows.filter((r) => r.order.kind === 'imaging').length,
    averageTatHours: tat.length ? Math.round((tat.reduce((a, b) => a + b, 0) / tat.length) * 10) / 10 : 0,
  };
}

/** The delta against the previous value, with the direction a clinician reads: up or down, not just different. */
export function compare(analyte: Analyte, current: number | string | undefined, previous: number | string | undefined): { text: string; tone: 'neutral' | 'warning' | 'critical' } {
  if (current === undefined || typeof current !== 'number') return { text: '—', tone: 'neutral' };
  if (previous === undefined || typeof previous !== 'number') return { text: 'first result on record', tone: 'neutral' };
  const delta = current - previous;
  if (Math.abs(delta) < 0.05 * Math.max(1, Math.abs(previous))) {
    return { text: `stable against ${previous} ${analyte.unit}`, tone: 'neutral' };
  }
  const verdict = delta > 0 ? 'up' : 'down';
  const flag = flagValue(analyte, current);
  const tone = isCritical(flag) ? 'critical' : flag === 'ok' ? 'neutral' : 'warning';
  return { text: `${verdict} from ${previous} ${analyte.unit} (${delta > 0 ? '+' : ''}${Math.round(delta * 100) / 100})`, tone };
}

export const SEARCH_RULES: Array<{ title: string; because: string }> = [
  { title: 'Only verified results are searchable by default', because: 'A value typed by a technician and not yet checked is not a result. Showing it beside verified values is how a number gets treated as one.' },
  { title: 'A trend compares like with like', because: 'Same analyte, same units, same laboratory. Two methods on one graph is how a stable patient looks like they deteriorated.' },
  { title: 'A critical result is a telephone call, and the call is recorded', because: 'A panic value that nobody acted on is the failure mode this module exists to prevent. The list of uncalled criticals is on the screen, not in a log.' },
  { title: 'A correction supersedes, it does not overwrite', because: 'A doctor who acted on the first number needs to see what they acted on, and why it changed.' },
  { title: 'Radiology is searched by the question asked', because: 'The report, the modality and the clinical indication are searchable; the images stay in the PACS, linked and never copied.' },
  { title: 'The window is always visible', because: 'A result search without a date range answers a different question than the one being asked, and usually the wrong one.' },
];

/** Radiology's own list, because an imaging report is read differently from an analyte panel. */
export function radiologyReports(dayIso: string): Array<{ order: DiagnosticOrder; test: LabTest; indication: string; reportedAt?: string; radiologist: string }> {
  const pool = resultPool(dayIso).filter((r) => r.order.kind === 'imaging');
  const radiologist = ['Dr S. Hossain (radiology)', 'Dr N. Barua (radiology)', 'Dr A. Kamal (radiology)'];
  return pool
    .sort((a, b) => b.order.orderedAt.localeCompare(a.order.orderedAt))
    .slice(0, 14)
    .map((r, i) => ({
      order: r.order,
      test: r.test,
      indication: r.order.report ?? 'Clinical indication recorded on the request.',
      ...(r.order.resultedAt ? { reportedAt: r.order.resultedAt } : {}),
      radiologist: radiologist[i % radiologist.length],
    }));
}

/** Who the search is for, when it is opened from a patient record. */
export function patientLabel(mrn: string): string {
  const p = patients.find((x) => x.mrn === mrn);
  return p ? `${p.name} · ${p.age} · ${p.sex}` : mrn;
}

export { tatStatus, flagTone, flagLabel };
