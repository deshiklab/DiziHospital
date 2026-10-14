'use client';

import { useState } from 'react';
import {
  Button,
  DataGrid,
  KpiTile,
  Panel,
  SafetyBanner,
  SyncPill,
  cx,
  useToast,
  type Column,
} from '@dizi/ui';
import { Cloud, CloudOff, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import {
  DEFAULT_BLOCKS,
  ENTITY_POLICY,
  blockLabel,
  blockRemaining,
  blockLow,
  runOutageDrill,
  waitingToSync,
  type Conflict,
  type DrillStep,
  type EntityKind,
  type Operation,
} from '@/lib/sync';
import { useShell } from '@/lib/shell';
import { todayIso } from '@/lib/appointments';

/* The sync console (P0-210/211) — where the offline path is visible instead of assumed.
 *
 * The plan's exit criterion for P1 is an outage drill: pull the uplink for an hour and lose nothing. That drill
 * cannot be an opinion, so this screen runs it in code, on the real engine, and shows every step — including the
 * two conflicts the other branch creates while this node is dark, and the person who settles them.
 *
 * What is real here: the operation ids, the per-node sequence numbers, the number blocks, the idempotent replay
 * (a drained queue drained again is dropped, not applied twice), the three conflict policies, and the refusal of
 * an exclusive claim. What is simulated: the transport. There is no server yet — `SimulatedCloud` is the stand-in,
 * and the screen says so rather than implying a backend exists.
 */

const POLICY_TONE: Record<Conflict['policy'], string> = {
  'append-only': 'bg-safety-success/10 text-safety-success',
  'field-level': 'bg-safety-warning/10 text-safety-warning',
  exclusive: 'bg-safety-critical/10 text-safety-critical',
};

const STEP_TONE: Record<DrillStep['tone'], string> = {
  info: 'bg-brand-500',
  success: 'bg-safety-success',
  warning: 'bg-safety-warning',
  critical: 'bg-safety-critical',
};

export default function SyncConsolePage() {
  const { sync, setSync, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();
  const [drill, setDrill] = useState<ReturnType<typeof runOutageDrill> | null>(null);
  const [remoteNote, setRemoteNote] = useState('edge-b has not written anything yet');
  const [manualNote, setManualNote] = useState<Record<string, string>>({});
  /** The last thing the contract refused to queue, in the contract's own words. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const { outbox, summary, cloud } = syncEngine;
  const refusedResults = outbox.results.filter((r) => r.outcome === 'refused');
  const oldest = outbox.pending.length
    ? Math.max(...outbox.pending.map((op) => Number(op.at.slice(11, 13)) * 60 + Number(op.at.slice(14, 16))))
    : null;

  const operationColumns: Array<Column<Operation>> = [
    { key: 'seq', header: '#', width: '4rem', render: (op) => <span className="font-numeric text-text-tertiary">{op.seq}</span> },
    { key: 'id', header: 'Operation id', width: '9rem', render: (op) => <span className="font-numeric text-xs">{op.id}</span> },
    { key: 'at', header: 'Written', width: '9rem', render: (op) => <span className="font-numeric text-xs">{op.at}</span> },
    { key: 'entity', header: 'Record', render: (op) => (
      <span className="flex flex-col">
        <span>{op.label}</span>
        <span className="text-xs text-text-tertiary">{ENTITY_POLICY[op.entity].label} · {op.recordId}</span>
      </span>
    ) },
    { key: 'op', header: 'Kind', width: '6rem', render: (op) => <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{op.op}</span> },
    { key: 'operationId', header: 'Contract operation', hideBelow: 'xl', render: (op) => {
      if (!op.operationId) {
        return <span className="text-xs text-safety-warning">not named by the screen — this write has no API operation to replay as</span>;
      }
      const capability = syncEngine.capabilityOf(op.operationId);
      return (
        <span className="flex flex-col">
          <span className="font-numeric text-xs">{op.operationId}</span>
          <span className="text-[11px] text-text-tertiary">{capability ? `${capability.method.toUpperCase()} ${capability.path} · ${capability.policy ?? 'platform'}` : 'not in the contract'}</span>
        </span>
      );
    } },
    { key: 'actor', header: 'By', hideBelow: 'lg', render: (op) => <span className="text-xs text-text-secondary">{op.actor} · {op.node}</span> },
  ];

  const enqueue = (write: Parameters<typeof syncEngine.enqueue>[0]) => {
    syncEngine.enqueue(write);
    push({
      title: cloud.reachable ? 'Written and sent' : 'Written on this device',
      description: cloud.reachable
        ? 'The operation has an id and a sequence number; draining is idempotent, so sending it twice applies it once.'
        : 'Saved here, queued, and applied to this device’s record immediately — the ward does not stop for the uplink.',
      tone: cloud.reachable ? 'success' : 'warning',
    });
  };

  const solve = (conflict: Conflict, choice: Conflict['resolution'] extends undefined ? never : NonNullable<Conflict['resolution']>['choice']) => {
    syncEngine.resolve(conflict.id, {
      at: `${day} 10:24`,
      by: 'Reception — Main Campus',
      choice,
      note: manualNote[conflict.id] || (choice === 'theirs' ? 'The other branch’s value was the correct one.' : 'Kept ours after confirming with the patient.'),
    });
    push({ title: `Conflict settled: ${choice === 'mine' ? 'kept ours' : choice === 'theirs' ? 'took theirs' : 'reassigned'}`, description: 'The losing value stays on the record with who decided and why — a decision, not a deletion.', tone: 'success' });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Sync console</h1>
          <p className="text-sm text-text-secondary">
            Node <span className="font-numeric font-medium">edge-a · Main Campus</span> · {day} · the other branch is{' '}
            <span className="font-numeric">edge-b</span> · {cloud.reachable ? 'the cloud is reachable' : 'the cloud is not reachable'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncPill state={sync} count={summary.pending} />
          <Button size="sm" variant={cloud.reachable ? 'secondary' : 'primary'} className="gap-1.5" onClick={() => { syncEngine.setUplink(!cloud.reachable); push({ title: cloud.reachable ? 'Uplink pulled' : 'Uplink restored', description: cloud.reachable ? 'Writes are queued and the ward keeps working on this device.' : 'Drain the queue to see what the server accepts, refuses and asks about.', tone: cloud.reachable ? 'warning' : 'success' }); }}>
            {cloud.reachable ? <WifiOff className="size-3.5" aria-hidden /> : <Wifi className="size-3.5" aria-hidden />}
            {cloud.reachable ? 'Pull the uplink' : 'Restore the uplink'}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { const result = syncEngine.drainNow(); push({ title: 'Queue drained', description: `${result.applied} applied · ${result.duplicates} duplicate(s) dropped · ${result.refused} refused · ${result.conflictsOpen} conflict(s) for a person.`, tone: result.conflictsOpen ? 'warning' : 'success' }); }}>
            <RefreshCw className="size-3.5" aria-hidden />
            Drain the queue
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { syncEngine.reset(); setRemoteNote('edge-b has not written anything yet'); push({ title: 'Engine reset', description: 'Empty outbox, full number blocks — the drill can be run again from the start.', tone: 'info' }); }}>
            Reset
          </Button>
        </div>
      </div>

      <SafetyBanner severity="info" title="P0-210/211/306 prototype — the protocol is real, the transport is simulated">
        Operation ids, per-node sequence numbers, reserved number blocks, idempotent replay, the three conflict
        policies and the queue’s contract metadata are all implemented and exercised here. The queue is saved on the
        device (<span className="font-numeric">dizi.outbox.v1</span>), so a reload keeps what is waiting — the earlier
        version kept it in memory only. There is still no server: the cloud side is a simulated peer inside this
        build, and the same drill has to be run on a real edge node with a real uplink before P1 can be signed off.
      </SafetyBanner>

      {syncEngine.storageNote && (
        <SafetyBanner severity="warning" title="This device’s saved queue needed attention">
          {syncEngine.storageNote}
        </SafetyBanner>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Queued writes" value={String(summary.pending)} definition="Operations written on this device that the server has not accepted yet. They are already applied here." asOf={`${day} · live`} footnote={summary.pending ? 'nothing is blocked while they wait' : 'the queue is empty'} />
        <KpiTile label="Oldest in the queue" value={oldest === null ? '—' : `${Math.max(0, 10 * 60 + 20 - oldest)} min`} definition="How long ago the oldest unconfirmed write was made." asOf={`${day} · live`} />
        <KpiTile label="Conflicts open" value={String(summary.conflictsOpen)} definition="Records where another branch changed the same field, or holds the record this node tried to take." asOf={`${day} · live`} footnote={`${summary.conflictsResolved} resolved`} />
        <KpiTile label="Applied" value={String(summary.applied)} definition="Operations the server accepted and confirmed, including on a replay." asOf={`${day} · live`} />
        <KpiTile label="Duplicates dropped" value={String(summary.duplicates)} definition="A replay of an operation the server had already applied: dropped by id, never applied twice." asOf={`${day} · live`} />
        <KpiTile label="Unconfirmed records" value={String(summary.unconfirmed)} definition="Records this device believes and the server has never confirmed — what a device lost under a bed would lose." asOf={`${day} · live`} footnote={summary.unconfirmed ? 'drain the queue' : 'everything is confirmed'} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Write something — with the uplink up or down" actions={<span className="text-xs text-text-tertiary">{cloud.reachable ? 'the cloud is reachable' : 'the uplink is down'}</span>}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => enqueue({ at: `${day} 10:12`, entity: 'nursing.note', recordId: 'med-a-12', label: 'Note for bed A-12', op: 'append', fields: { note: 'Wound edge clean; dressing changed.' }, actor: 'S. Sultana', node: 'Medicine Ward A' })}>
              Add a nursing note
            </Button>
            <Button size="sm" variant="ghost" onClick={() => enqueue({ at: `${day} 10:13`, entity: 'mar.dose', recordId: 'mar-8830', label: 'Morphine 10 mg for bed A-12', op: 'claim', fields: { dose: 'Given', witness: 'N. Haque' }, actor: 'S. Sultana', node: 'Medicine Ward A' })}>
              Sign a controlled dose
            </Button>
            <Button size="sm" variant="ghost" onClick={() => enqueue({ at: `${day} 10:14`, entity: 'payment', recordId: 'rc-8842', label: 'Cash 1 200 received at the counter', op: 'append', fields: { amount: 1200, method: 'Cash' }, actor: 'Billing', node: 'Billing counter' })}>
              Take a cash payment
            </Button>
            <Button size="sm" variant="ghost" onClick={() => enqueue({ at: `${day} 10:15`, entity: 'patient.contact', recordId: 'SH-102311', label: 'Phone corrected at the desk', op: 'set', fields: { phone: '01711223344' }, actor: 'Reception', node: 'OPD desk' })}>
              Correct a phone number
            </Button>
            <Button size="sm" variant="ghost" onClick={() => enqueue({ at: `${day} 10:16`, entity: 'bed.state', recordId: 'med-a-19', label: 'Admit into bed A-19', op: 'claim', fields: { admitted: 'SH-103902' }, actor: 'Ward desk', node: 'Medicine Ward A' })}>
              Admit into bed A-19
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onClick={() => {
                const outcome = syncEngine.queueOperation('createPatient', {
                  at: `${day} 10:17`,
                  recordId: 'SH-200312',
                  label: 'Register Rahim Uddin at the desk',
                  fields: { name: 'Rahim Uddin', phone: '01711223344' },
                  actor: 'Reception',
                  node: 'OPD desk',
                });
                setRefusal(outcome.queued ? null : outcome.because);
                push({
                  title: outcome.queued ? 'Registered by the contract' : 'The contract refused this one',
                  description: outcome.queued
                    ? 'The screen named the operation — createPatient — and the queue took its entity, its policy and its kind from the API contract rather than from a rule kept in the screen.'
                    : outcome.because,
                  tone: outcome.queued ? 'success' : 'warning',
                });
              }}
            >
              Register a patient — the contract names the operation
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Deliberately online-only, and the contract says why. The answer comes back synchronously, so a
                // screen can grey this out before anyone taps it — which is the point of P0-306.
                const outcome = syncEngine.queueOperation('listNumberBlocks', {
                  at: `${day} 10:18`,
                  recordId: 'node/edge-a',
                  label: 'Reserve the next number block',
                  actor: 'System',
                  node: 'edge-a',
                });
                setRefusal(outcome.queued ? null : outcome.because);
                push({
                  title: outcome.queued ? 'Queued' : 'This one cannot be queued',
                  description: outcome.queued ? 'Unexpected — this operation is online-only in the contract.' : outcome.because,
                  tone: outcome.queued ? 'success' : 'info',
                });
              }}
            >
              Attempt an action that needs the network
            </Button>
          </div>
          {refusal && (
            <p className="mt-2 rounded-md border border-safety-warning/40 bg-safety-warning/5 p-2 text-sm">
              {refusal}
            </p>
          )}
          <p className="mt-2 text-xs text-text-tertiary">
            Each write gets an id before it leaves the row it was made in, is applied to this device’s record
            immediately, and joins the queue. That is what makes a device that goes dark for an hour a delay instead
            of a loss.
          </p>
        </Panel>

        <Panel title="Make the other branch write while we are dark">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => { cloud.writeFrom('edge-b', 'patient.contact', 'SH-102311', 'Phone at Uttara', { address: 'House 12, Sector 7, Uttara' }, `${day} 10:18`); setRemoteNote('edge-b changed the address for SH-102311 (a different field)'); push({ title: 'edge-b wrote a different field', description: 'Different fields merge without a decision — that is the field-level rule doing its job.', tone: 'info' }); }}>
              Change a different field
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { cloud.writeFrom('edge-b', 'patient.demographic', 'SH-104088', 'Age at Uttara', { age: 47 }, `${day} 10:19`); setRemoteNote('edge-b changed the age for SH-104088 (the same field we changed)'); push({ title: 'edge-b wrote the same field', description: 'Now a drain is a real conflict: same field, two values, and only the patient knows which is right.', tone: 'warning' }); }}>
              Change the same field
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { cloud.hold('med-a-19', 'edge-b'); setRemoteNote('edge-b admitted a patient into bed A-19'); push({ title: 'edge-b took bed A-19', description: 'A bed holds one patient, so this cannot be merged: the next claim will be refused, with the holder named.', tone: 'warning' }); }}>
              Take the same bed
            </Button>
          </div>
          <p className="mt-2 text-xs text-text-tertiary">{remoteNote}</p>
        </Panel>
      </div>

      <Panel title={`The outbox — ${outbox.pending.length} operation(s) waiting`}>
        {outbox.pending.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing is waiting. Every write this node made has been accepted (or refused with a decision on the list
            below) — {summary.applied} applied in total.
          </p>
        ) : (
          <DataGrid<Operation>
            id="sync-outbox"
            caption="Queued operations"
            columns={operationColumns}
            rows={outbox.pending}
            total={outbox.pending.length}
            page={1}
            pageSize={25}
            rowId={(op) => op.id}
            height="18rem"
            printMeta={`Outbox on edge-a · ${outbox.pending.length} operation(s) awaiting the server`}
          />
        )}
        {outbox.pending.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-xs text-text-secondary">
            {waitingToSync(outbox).map(({ operation, capability }) => (
              <li key={operation.id} className="flex flex-wrap items-center gap-2">
                <span className="font-numeric text-text-tertiary">{operation.id}</span>
                <span aria-hidden>→</span>
                {capability ? (
                  <>
                    <span className="font-numeric">{`${capability.method.toUpperCase()} ${capability.path}`}</span>
                    {capability.policy ? (
                      <span className={cx('rounded-full px-2 py-0.5', POLICY_TONE[capability.policy])}>{capability.policy}</span>
                    ) : (
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5">platform</span>
                    )}
                    <span className="text-text-tertiary">
                      {capability.audit ? 'audited' : 'not audited'} ·{' '}
                      {capability.mayQueue ? 'replayed on drain' : 'not queueable — it needs the network'}
                    </span>
                  </>
                ) : (
                  <span className="text-safety-warning">
                    queued without a contract operation — a replay has nothing to send it as
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Reconciliation — ${summary.conflictsOpen} open, ${summary.conflictsResolved} settled`}>
        {outbox.conflicts.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No conflicts. Run the drill, or make the other branch write while this node is dark, and they appear here
            with both values side by side and a person to choose.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {outbox.conflicts.map((conflict) => (
              <li key={conflict.id} className="rounded-md border border-border-subtle bg-surface-default p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx('rounded-full px-2 py-0.5 text-xs', POLICY_TONE[conflict.policy])}>{conflict.policy}</span>
                  <span className="font-medium">{conflict.label}</span>
                  <span className="font-numeric text-xs text-text-tertiary">{conflict.recordId} · detected {conflict.detectedAt}</span>
                  {conflict.resolution && (
                    <span className="ml-auto rounded-full bg-safety-success/10 px-2 py-0.5 text-xs text-safety-success">
                      settled by {conflict.resolution.by}
                    </span>
                  )}
                </div>
                {conflict.heldBy && (
                  <p className="mt-1 text-sm text-safety-critical">
                    {conflict.heldBy} already holds this record. An exclusive record cannot be merged — the second
                    arrival needs another bed, and the record stays with whoever got there first.
                  </p>
                )}
                <table className="mt-2 w-full text-left text-sm">
                  <thead className="text-xs text-text-secondary">
                    <tr>
                      <th scope="col" className="py-1">Field</th>
                      <th scope="col" className="py-1">This node (edge-a)</th>
                      <th scope="col" className="py-1">The other branch (edge-b)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflict.fields.map((f) => (
                      <tr key={f.field} className="border-t border-border-subtle">
                        <td className="py-1 text-xs">{f.field}</td>
                        <td className="py-1">
                          {String(f.mine)}
                          <span className="block font-numeric text-[11px] text-text-tertiary">{f.mineAt}</span>
                        </td>
                        <td className="py-1">
                          {String(f.theirs)}
                          <span className="block font-numeric text-[11px] text-text-tertiary">{f.theirsAt}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {conflict.merged.length > 0 && (
                  <p className="mt-1 text-xs text-text-tertiary">
                    Merged without a decision: {conflict.merged.map((m) => `${m.field} “${m.mine}”`).join(', ')} — the
                    other branch changed a different field, so both are kept.
                  </p>
                )}

                {conflict.resolution ? (
                  <p className="mt-2 rounded-md bg-surface-sunken p-2 text-xs">
                    <strong>{conflict.resolution.choice === 'mine' ? 'Kept ours' : conflict.resolution.choice === 'theirs' ? 'Took theirs' : conflict.resolution.choice === 'reassigned' ? 'Reassigned here' : 'Merged by hand'}</strong>{' '}
                    — {conflict.resolution.note} ({conflict.resolution.at} · {conflict.resolution.by}). The losing value
                    stays on the record: “which number did the patient give us” is a question people ask later.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Button size="sm" onClick={() => solve(conflict, 'mine')}>Keep ours</Button>
                    <Button size="sm" variant="secondary" onClick={() => solve(conflict, 'theirs')}>Take theirs</Button>
                    {conflict.policy === 'exclusive' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          syncEngine.resolve(conflict.id, {
                            at: `${day} 10:26`,
                            by: 'Ward desk — Main Campus',
                            choice: 'reassigned',
                            reassignTo: 'med-a-21',
                            note: 'The patient went into bed A-21 instead; the other branch keeps A-19.',
                          })
                        }
                      >
                        Move to another bed (A-21)
                      </Button>
                    )}
                    <label className="flex min-w-64 flex-1 flex-col gap-1">
                      <span className="text-xs text-text-secondary">Note (recorded with the decision)</span>
                      <input
                        className="h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm"
                        value={manualNote[conflict.id] ?? ''}
                        onChange={(e) => setManualNote((m) => ({ ...m, [conflict.id]: e.target.value }))}
                        placeholder="Who was told, and what they decided…"
                      />
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Refused writes — ${refusedResults.length} needing a decision`}>
        {refusedResults.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing has been refused. A refusal is not a retry: the write leaves the queue, keeps its place in the
            history, and is shown to the desk with the reason — the contract’s own sentence, not an error code.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {refusedResults.map((result) => {
              const capability = result.operation.operationId ? syncEngine.capabilityOf(result.operation.operationId) : null;
              return (
                <li key={`${result.operation.id}-refused`} className="rounded-md border border-safety-warning/40 bg-safety-warning/5 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{result.operation.label}</span>
                    <span className="font-numeric text-xs text-text-tertiary">
                      {result.operation.id}
                      {result.operation.operationId ? ` · ${result.operation.operationId}` : ' · no contract operation'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">{result.reason ?? 'The server refused it.'}</p>
                  {capability?.because && <p className="mt-1 text-sm">{capability.because}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Number blocks reserved on this node">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Reserved number series</caption>
            <thead className="bg-surface-sunken text-xs text-text-secondary">
              <tr>
                <th scope="col" className="px-2 py-1.5">Series</th>
                <th scope="col" className="px-2 py-1.5">Block</th>
                <th scope="col" className="px-2 py-1.5 text-right">Left</th>
                <th scope="col" className="px-2 py-1.5">State</th>
              </tr>
            </thead>
            <tbody>
              {outbox.blocks.map((block) => (
                <tr key={block.series} className="border-t border-border-subtle">
                  <td className="px-2 py-1.5">{block.series}</td>
                  <td className="px-2 py-1.5 font-numeric text-xs">{blockLabel(block)}</td>
                  <td className={cx('font-numeric px-2 py-1.5 text-right', blockLow(block) && 'text-safety-warning')}>{blockRemaining(block)}</td>
                  <td className="px-2 py-1.5 text-xs">
                    {blockRemaining(block) === 0 ? <span className="text-safety-critical">exhausted — reserve another block</span> : blockLow(block) ? <span className="text-safety-warning">running low</span> : 'healthy'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-text-tertiary">
            Registered numbers come from a block this node owns, so registering a patient never waits for the uplink
            and two nodes never draw the same number. An exhausted block is a visible shortage, not a duplicate
            patient. {DEFAULT_BLOCKS.length} series are reserved here.
          </p>
        </Panel>

        <Panel title="Conflict rules — one policy per entity, decided once">
          <ul className="flex flex-col gap-2 text-sm">
            {(Object.keys(ENTITY_POLICY) as EntityKind[]).map((entity) => (
              <li key={entity} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className={cx('rounded-full px-2 py-0.5 text-xs', POLICY_TONE[ENTITY_POLICY[entity].policy])}>{ENTITY_POLICY[entity].policy}</span>
                  <span className="font-medium">{ENTITY_POLICY[entity].label}</span>
                </span>
                <span className="text-xs text-text-secondary">{ENTITY_POLICY[entity].why}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="The outage drill — pull the uplink for an hour and lose nothing"
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              const result = runOutageDrill();
              setDrill(result);
              push({
                title: result.lostWrites === 0 ? 'Drill passed: no writes lost' : `Drill failed: ${result.lostWrites} write(s) lost`,
                description: `${result.summary.applied} applied · ${result.summary.refused} refused · ${result.summary.conflictsResolved} conflict(s) settled by a person.`,
                tone: result.lostWrites === 0 ? 'success' : 'critical',
              });
            }}
          >
            <CloudOff className="size-3.5" aria-hidden />
            Run the drill
          </Button>
        }
      >
        {!drill ? (
          <p className="text-sm text-text-secondary">
            The drill makes nine writes the way a shift does, with the uplink already down, has the other branch edit
            two of the same records and take one of the same beds, then restores the link and drains. It asserts its
            own result: every operation accounted for, every conflict on the reconciliation list, and the number of
            lost writes equal to zero.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className={cx('flex flex-wrap items-center gap-3 rounded-md border p-2', drill.lostWrites === 0 ? 'border-safety-success/40 bg-safety-success/5' : 'border-safety-critical/40 bg-safety-critical/5')}>
              <Cloud className={cx('size-5', drill.lostWrites === 0 ? 'text-safety-success' : 'text-safety-critical')} aria-hidden />
              <span className="text-sm font-medium">
                {drill.lostWrites === 0 ? 'No writes lost across the outage' : `${drill.lostWrites} write(s) lost — the drill failed`}
              </span>
              <span className="text-xs text-text-secondary">
                {drill.summary.applied} applied · {drill.summary.duplicates} duplicate(s) dropped · {drill.summary.refused} refused ·{' '}
                {drill.summary.conflictsResolved} conflict(s) settled · {drill.summary.unconfirmed} record(s) unconfirmed
              </span>
            </div>

            <ol className="flex flex-col gap-2">
              {drill.steps.map((step) => (
                <li key={`${step.at}-${step.text}`} className="flex gap-2">
                  <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', STEP_TONE[step.tone])} />
                  <span className="font-numeric w-24 shrink-0 text-xs text-text-tertiary">{step.at}</span>
                  <span className="flex-1 text-sm">{step.text}</span>
                </li>
              ))}
            </ol>

            <SafetyBanner severity="info" title="What this drill proves, and what it does not">
              It proves the protocol: a queued write survives an outage, a replay is dropped rather than applied
              twice, an exhausted number block is refused instead of wrapped, a same-field edit becomes a decision
              with both values kept, and an exclusive claim is refused with the holder named. It does not prove the
              transport, the edge node, or behaviour under two hundred queued writes on a bad LAN — that is the drill
              on real hardware in front of the P1 sign-off.
            </SafetyBanner>
          </div>
        )}
      </Panel>

      <Panel title="Simulate the pill, for review">
        <div className="flex flex-wrap items-center gap-2">
          {(['live', 'lanOnly', 'queued', 'syncing', 'conflict', 'stale'] as const).map((s) => (
            <Button key={s} size="sm" variant={sync === s ? 'primary' : 'secondary'} onClick={() => setSync(s)}>
              {s}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-text-tertiary">
          The header pill across every state the plan asks for. Draining the queue sets it from what actually
          happened — live, waiting, or needs review — instead of a switch somebody has to remember to move; this row
          stays only so a reviewer can see each state on demand.
        </p>
      </Panel>
    </div>
  );
}
