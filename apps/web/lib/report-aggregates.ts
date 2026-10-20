/* ---------------------------------------------------------------------------------------------------------------
 * Report aggregates — one answer per report, scope, period and day (P6 leftovers, fourth item).
 *
 * Every report screen used to call `buildReport` on its own render: the same table, recomputed by every browser,
 * over whatever each replica happened to hold. Two problems, and only one of them is speed:
 *
 *  1. **It is slow in a way that grows with the hospital.** Seventeen reports, each walking the appointments, the
 *     dispensary, the ledger and the ward for up to thirty days, on the machine at the counter.
 *  2. **It is wrong in a way nobody notices.** Two desks reading the same report from replicas that have drained
 *     different amounts print two different totals, and neither screen can say why. A management report exists to
 *     be argued with, and the argument is unwinnable if the figure depends on who opened it.
 *
 * So the aggregate belongs on the server, and the contract says so: `GET /reports/{topic}/aggregate` returns the
 * table computed once, with the watermark (`registerAt`) the figures were read at and which tier answered
 * (`computedBy`). This module is the seam that operation will occupy.
 *
 * Today: `aggregateFor` computes on the node, reads each key once for as long as the tab is open, and returns what
 * it did — the time it took, whether it was a recomputation, and the watermark of this replica — so the screen can
 * print all of it and nobody has to take the word "cached" on trust. When the API exists, this one file reads
 * `reportAggregate` and returns `source: 'server'`; the screens do not change, which is the only reason a seam is
 * worth having rather than a promise.
 *
 * What the seam deliberately does *not* move is the report's own definition. The question a report answers, its
 * columns, its hints, its saved views, its refusal to add up a maximum — that is the product's, and it belongs in
 * the build. The *figures* are the register's, and those are what the server will own.
 */

import { buildSnapshot, type RangeId, type ReportsSnapshot } from './reports';
import { buildReport, type ReportTable, type Scope } from './report-suite';

export interface AggregateKey {
  topic: string;
  scope: Scope;
  range: RangeId;
  day: string;
}

export type AggregateSource = 'node' | 'server';

export interface AggregateAnswer {
  table: ReportTable;
  /** `node` while this build computes it here; `server` once the API answers `reportAggregate`. */
  source: AggregateSource;
  /** True when this call was answered from the tab's cache rather than computed for it. */
  cached: boolean;
  /** How long the computation took, in milliseconds — the cost the server is being asked to carry once. */
  ms: number;
  /** The replication watermark the figures were read at, in words the screen can print. */
  registerAt: string;
  /** The sentence a screen shows beside the figures. */
  because: string;
}

const keyOf = (k: AggregateKey): string => `${k.topic}|${k.scope}|${k.range}|${k.day}`;

const cache = new Map<string, { table: ReportTable; ms: number; registerAt: string }>();

/**
 * The watermark a render is allowed to print.
 *
 * A component that is rendered on the server and hydrated in the browser has to draw the same text twice, and this
 * is the version of the watermark that can: a constant. The precise one — which node, at which sequence, with how
 * much still queued — is `nodeWatermark()` below, and it may only be called from an effect.
 */
export const NODE_REPLICA = 'this node’s replica, as far as the last drain';

/**
 * What this node's replica is at, in its own words.
 *
 * The figures are only as current as the writes the node has drained, and that is the honest thing to print beside
 * a total: not “live”, not “as of now”, but which node answered and how much is still in its outbox.
 *
 * Read it from an effect, never during render: the server render has no storage, so a value taken during render is
 * one string in the HTML and another in the browser, which is React #418 and a discarded tree. The screens put the
 * result in state, which is why this module exports both this and `NODE_REPLICA`.
 */
export function nodeWatermark(): string {
  if (typeof window === 'undefined') return NODE_REPLICA;
  try {
    const outbox = JSON.parse(window.localStorage.getItem('dizi.outbox.v1') ?? 'null');
    if (!outbox) return 'this node’s replica, with nothing queued for the cloud';
    const pending = Array.isArray(outbox.pending) ? outbox.pending.length : 0;
    return `${outbox.nodeId ?? 'this node'} at sequence ${outbox.seq ?? 0}, ${pending === 0 ? 'with nothing queued for the cloud' : `with ${pending} write${pending === 1 ? '' : 's'} still queued for the cloud`}`;
  } catch {
    return 'this node’s replica';
  }
}

/**
 * One report, read once.
 *
 * `recompute` is what the screen's own "read it again" presses: it throws the cached answer for this key away and
 * computes afresh, so a reader who doubts a stale number has a way to spend the machine's time on purpose. Every
 * other call with the same key is served the same table object — not an equal one, the same one — which is what
 * makes "one key, one answer" a fact about this module rather than a hope about the server.
 */
export function aggregateFor(key: AggregateKey, options: { recompute?: boolean; registerAt?: string } = {}): AggregateAnswer {
  const id = keyOf(key);
  const previous = options.recompute ? undefined : cache.get(id);

  if (previous) {
    return {
      table: previous.table,
      source: 'node',
      cached: true,
      ms: previous.ms,
      registerAt: previous.registerAt,
      because: `This tab already read ${previous.table.def.title} for ${key.scope}, ${key.range === 'today' ? 'today' : key.range === 'week' ? 'the last seven days' : 'the last thirty days'}: the same table, not a second computation. The server will answer it the same way — one key, one answer, at one watermark.`,
    };
  }

  const started = Date.now();
  const table = buildReport(key.topic, { day: key.day, range: key.range, scope: key.scope });
  const ms = Math.max(0, Date.now() - started);
  const registerAt = options.registerAt ?? NODE_REPLICA;
  cache.set(id, { table, ms, registerAt });

  return {
    table,
    source: 'node',
    cached: false,
    ms,
    registerAt,
    because: `Computed on this node in ${ms} ms, from the register this replica holds, over ${table.daysRead.length} day${table.daysRead.length === 1 ? '' : 's'} of data. The API’s own reportAggregate returns the same table computed once for every reader at a named watermark, which is what stops two desks arguing from two totals — and is why this screen names the watermark and the milliseconds instead of saying “live”.`,
  };
}

/** How many keys this tab is holding — the screen prints it, and the harness checks the cache is real. */
export const aggregateCacheSize = (): number => cache.size;

/** Empty the cache: what a day change, a sign-out or a drain of the outbox should do. */
export const clearAggregates = (): void => {
  cache.clear();
};

/* ---------------------------------------------------------------------------------------------------- the hub */

export interface SnapshotAnswer {
  snapshot: ReportsSnapshot;
  source: AggregateSource;
  cached: boolean;
  ms: number;
  because: string;
}

const snapshots = new Map<string, { snapshot: ReportsSnapshot; ms: number }>();

/**
 * The hub's own dashboard figures, through the same seam and for the same reason.
 *
 * The dashboard is the aggregate most people read first, and it walks every register to build itself. It moves with
 * the reports — one call, one answer — rather than staying a per-browser summary that can disagree with the report
 * it summarises.
 */
export function snapshotFor(range: RangeId, day: string, options: { recompute?: boolean } = {}): SnapshotAnswer {
  const id = `${range}|${day}`;
  const previous = options.recompute ? undefined : snapshots.get(id);
  if (previous) {
    return {
      snapshot: previous.snapshot,
      source: 'node',
      cached: true,
      ms: previous.ms,
      because: 'This tab already built the dashboard for this period: the same snapshot, not a second walk through the registers.',
    };
  }
  const started = Date.now();
  const snapshot = buildSnapshot(range, day);
  const ms = Math.max(0, Date.now() - started);
  snapshots.set(id, { snapshot, ms });
  return {
    snapshot,
    source: 'node',
    cached: false,
    ms,
    because: `Built on this node in ${ms} ms. The reports’ own figures move to the server first (reportAggregate); this dashboard follows the same seam, so the number on it and the number in the report it links to cannot come from two different walks.`,
  };
}

export const AGGREGATE_SEAM = {
  operationId: 'reportAggregate',
  endpoint: 'GET /reports/{topic}/aggregate?scope=&range=&day=',
  today: 'The screens call aggregateFor(), which computes on this node, reads each key once per tab, and prints what it did: the milliseconds, whether it was a recomputation, and the watermark of the replica it read.',
  tomorrow: 'The API computes the table once against the register and returns it with computedBy: cloud and the registerAt watermark. aggregateFor() reads that operation and returns source: server; no screen changes.',
  why: 'Two desks reading one report from replicas that have drained different amounts print two totals, and neither screen can say why. One computation at one watermark is the fix, and it is also what makes the figure cheap.',
} as const;
