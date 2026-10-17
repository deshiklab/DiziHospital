/* -----------------------------------------------------------------------------
 * Sync engine (P0-210/211) — the offline queue, the conflict rules and the reconciliation.
 *
 * A hospital LAN platform whose offline path is unproven is a liability, not a feature: the uplink to the cloud
 * goes down, the ward keeps charting, and the difference between a good system and a bad one is what happens in
 * the ten minutes after it comes back.
 *
 * The design, and why each part is here:
 *
 *  1. **Every write gets a client id before it leaves the screen.** `nodeId` + a per-node sequence number means a
 *     replay after a reconnect is idempotent: the server drops an operation it has already applied, so a queued
 *     dose signed twice is signed once.
 *  2. **The outbox is ordered and append-only.** Nothing is edited in the queue; a correction is another
 *     operation. That is what makes the drain safe to interrupt — the queue is a log, not a buffer.
 *  3. **Numbering comes from blocks reserved per node** (`MRN-BLK`, `INV-BLK`), because an MRN must never collide
 *     and a node that cannot reach the server cannot ask it for the next one. A block that runs out is an alert,
 *     not a wrap-around.
 *  4. **Conflicts are classified, not averaged.** Three classes, three different answers:
 *     - *Append-only* (nursing notes, observations, audit, dispense lines): two nodes never conflict, both apply.
 *     - *Field-level* (demographics, contact details): if the two sides changed **different** fields, both merge
 *       silently; if they changed the **same** field to different values, a human picks — and until they do, the
 *       newer value stands but the conflict stays on the list.
 *     - *Exclusive* (a bed can hold one patient): the server refuses the second claim. A bed cannot be last-write-
 *       wins; the patient already in it would have to be evicted by a clock.
 *  5. **Nothing is deleted in a conflict.** The losing value is kept with the winner and the reason, because
 *     "which number did the patient give us" is a question people ask later.
 *
 * This module is a prototype in the honest sense: the protocol (ids, sequence numbers, number blocks, conflict
 * classification, reconciliation list) is real and testable; the transport is simulated, and `SimulatedCloud`
 * exists so the offline drill can be run — and be seen to pass — without a server.
 */

/* ------------------------------------------------------------------ entities and shapes */

/**
 * The contract decides what may be queued. `@dizi/contracts/client` is generated from
 * `packages/contracts/openapi.json` (P0-207), and the metadata below is read from it rather than restated here:
 * an operation the contract marks `online-only` cannot be queued however convenient that would be, and the
 * sentence shown to the desk when the app refuses something is the contract's own `because`.
 *
 * The entity policies stay written out in this file on purpose. They are the ones the desks have been running
 * against since P0-201, and `packages/contracts/check.mjs` compares the two tables entity by entity — a check
 * that would be worth nothing if this file merely imported the answer it is being checked against.
 */
import { operations as contractOperations, type OperationMeta } from '@dizi/contracts/client';

export type EntityKind =
  | 'patient.demographic'
  | 'patient.contact'
  | 'appointment'
  | 'bed.state'
  | 'admission'
  | 'observation'
  | 'nursing.note'
  | 'mar.dose'
  | 'invoice'
  | 'payment'
  | 'ledger.income'
  | 'ledger.expense'
  | 'claim'
  | 'commission.payout'
  | 'staff.member'
  | 'leave.request'
  | 'attendance.punch'
  | 'payroll.run'
  | 'vital.event'
  | 'visitor.pass'
  | 'branch.setting'
  | 'platform.setting'
  | 'telemedicine.session'
  | 'content.item'
  | 'content.type'
  | 'certificate.issue'
  | 'identity.card'
  | 'survey.form'
  | 'survey.assignment'
  | 'survey.response'
  | 'cms.page'
  | 'print.template'
  | 'report.schedule'
  | 'report.run'
  | 'message.notice'
  | 'message.delivery'
  | 'portal.feedback'
  | 'prescription'
  | 'lab.result'
  | 'audit';

/** How two writers on different nodes are allowed to collide on this entity. */
export type ConflictPolicy = 'append-only' | 'field-level' | 'exclusive';

export const ENTITY_POLICY: Record<EntityKind, { policy: ConflictPolicy; label: string; why: string }> = {
  /* Nothing queues a delivery: a message that has left the hospital cannot be replayed later, so the retry is
     online-only by contract. The policy is here because the entity is in the contract's registry and this table is
     checked against it — and because "two nodes each appended an attempt" is a fact the log has to be able to show. */
  'message.delivery': {
    policy: 'append-only',
    label: 'Notification delivery',
    why: 'An attempt is a fact about a moment: which channel, which template, and the provider\u2019s own message id or its own error. A retry appends the next attempt rather than editing the one that failed.',
  },
  'patient.demographic': {
    policy: 'field-level',
    label: 'Patient identity',
    why: 'Two desks can both correct a name or an age. Different fields merge; the same field needs a person, because one of the two is wrong and only the patient knows which.',
  },
  'patient.contact': {
    policy: 'field-level',
    label: 'Patient contact details',
    why: 'Phone numbers change and relatives answer. Different fields merge; the same field is offered to the desk, with both values kept.',
  },
  appointment: {
    policy: 'exclusive',
    label: 'Appointment slot',
    why: 'A slot holds one patient. The branch that took the booking owns it, and a second branch asking for the same slot is refused with the alternatives rather than merged.',
  },
  'bed.state': {
    policy: 'exclusive',
    label: 'Bed state',
    why: 'A bed holds one patient. Two nodes admitting into the same bed is not a merge — the second arrival needs another bed, so the server refuses the claim.',
  },
  admission: {
    policy: 'append-only',
    label: 'Admission',
    why: 'An admission is an event with a time and an author. Two events on two nodes are two events.',
  },
  observation: {
    policy: 'append-only',
    label: 'Observation set',
    why: 'A set of vitals is a measurement at a time. Two sets are two measurements, and both belong on the chart.',
  },
  'nursing.note': {
    policy: 'append-only',
    label: 'Nursing note',
    why: 'Notes are the record of what was seen and done. Nothing merges and nothing is overwritten.',
  },
  'mar.dose': {
    policy: 'exclusive',
    label: 'Medication administration',
    why: 'A dose is given once. Two nodes signing the same slot is a double-dose risk: the first signature stands and the second is refused with the reason.',
  },
  invoice: {
    policy: 'append-only',
    label: 'Invoice',
    why: 'Invoices are reversed and reissued, never edited — so two nodes produce two documents and a credit note, not one merged figure.',
  },
  payment: {
    policy: 'append-only',
    label: 'Payment',
    why: 'Money received is a fact with a counter and a time. Two receipts are two payments.',
  },
  'ledger.income': {
    policy: 'append-only',
    label: 'Income voucher',
    why: 'A receipt is money in the drawer at a time and a counter. Two receipts are two movements, and a wrong one is reversed by another voucher rather than deleted — which is the only kind of correction an auditor accepts.',
  },
  'ledger.expense': {
    policy: 'append-only',
    label: 'Expense voucher',
    why: 'A payment is money out with a payee and a cheque or transfer behind it. The bank statement will show both, so nothing merges and nothing is edited after the fact.',
  },
  claim: {
    policy: 'exclusive',
    label: 'Payer claim',
    why: 'One invoice is claimed once with one payer. Two desks submitting the same bill is a duplicate claim, which payers find and hospitals are repaid for by being put on a watch list, so the second submission is refused with the claim number that already holds it.',
  },
  'commission.payout': {
    policy: 'append-only',
    label: 'Commission payout',
    why: 'A payout is an event: a voucher number, an amount, a withholding, a reference and two names. Nothing about it is edited afterwards — a mistake is corrected by a reversing voucher, and the bank statement shows both.',
  },
  'staff.member': {
    policy: 'field-level',
    label: 'Staff record',
    why: 'Two desks may both correct a designation, a phone number or a bank account. Different fields merge; the same field needs HR, because one of the two values is the one a salary is paid into.',
  },
  'leave.request': {
    policy: 'exclusive',
    label: 'Leave request',
    why: 'A leave application is one person’s days, decided once. Two approvers deciding the same application is two answers to one question — the second is refused with the decision already on the record.',
  },
  'attendance.punch': {
    policy: 'append-only',
    label: 'Attendance punch',
    why: 'A punch is a fact about a body being in a building at a time. A correction is a second record naming who corrected it and why, never an edit of the first.',
  },
  'payroll.run': {
    policy: 'exclusive',
    label: 'Payroll run',
    why: 'A month is paid once per branch. Two nodes running the same month is two bank files for the same salary, so the second is refused rather than merged.',
  },
  'vital.event': {
    policy: 'append-only',
    label: 'Birth or death record',
    why: 'These are notifications to the state as well as clinical records. Nothing about a birth or a death is edited after the fact: a correction is an amended entry naming what it changes.',
  },
  'visitor.pass': {
    policy: 'exclusive',
    label: 'Visitor pass',
    why: 'One badge, one visitor, one desk. A visitor who is already inside cannot be signed in again at another desk — the second attempt is refused with the pass that already holds them.',
  },
  'branch.setting': {
    policy: 'field-level',
    label: 'Branch setting',
    why: 'Two administrators may each change a different branch setting. Different keys merge; the same key needs a person, because the day book and the receipt header cannot read two values.',
  },
  'platform.setting': {
    policy: 'field-level',
    label: 'Platform setting',
    why: 'Configuration is edited by more than one administrator, and most keys are independent. Different keys merge; the same key is the one case where somebody has to choose, since the next patient sees only one of the two.',
  },
  audit: {
    policy: 'append-only',
    label: 'Audit entry',
    why: 'The ledger of who did what is the one thing that must never be merged away.',
  },
  'telemedicine.session': {
    policy: 'field-level',
    label: 'Live consultation or meeting',
    why: 'A session is opened by a doctor and ended by whoever is still in the room, and the two may be on different nodes. A correction to the outcome merges by field; two ends are the same end.',
  },
  'content.item': {
    policy: 'field-level',
    label: 'Shared file',
    why: 'The file itself never changes, but its title, its tags and who may see it do. Two nodes retitling the same upload merge by field, and the bytes are addressed by hash so they cannot diverge.',
  },
  'content.type': {
    policy: 'field-level',
    label: 'Content type',
    why: 'A content type is a taxonomy row every branch reads and one administrator edits. A merge by field is right; the key is the identity and is never rewritten.',
  },
  'certificate.issue': {
    policy: 'append-only',
    label: 'Issued certificate',
    why: 'A certificate carries a number that is already printed on paper and handed to a person. It is issued, and if the hospital was wrong it issues a superseding certificate — it does not edit the one in the patient’s hand.',
  },
  'identity.card': {
    policy: 'append-only',
    label: 'Issued identity card',
    why: 'A card is a physical object with a number on it. Re-issuing because a photograph was wrong appends a new card and revokes the old one; the register has to be able to say which card was in circulation when.',
  },
  'survey.form': {
    policy: 'field-level',
    label: 'Survey form',
    why: 'A form is drafted by one person and reviewed by another, both of whom may edit different questions on different nodes. Field-level merging keeps both edits; the question list is compared as one field.',
  },
  'survey.assignment': {
    policy: 'field-level',
    label: 'Survey assignment',
    why: 'An assignment is issued to a person who answers it, and the person who issued it may withdraw it. Field-level: the answer state and the withdrawal are different fields and both are true.',
  },
  'survey.response': {
    policy: 'append-only',
    label: 'Survey response',
    why: 'An answer is what somebody said at a time. It is appended and never corrected — correcting a survey destroys the only thing a survey is for.',
  },
  'cms.page': {
    policy: 'field-level',
    label: 'Website page',
    why: 'A page is edited by the content team and the branch administrator, usually in different places. Field-level merging keeps both edits, and the publication state is decided once and separately.',
  },
  'print.template': {
    policy: 'append-only',
    label: 'Print template',
    why: 'A published layout is what a family was handed on a date: two branches may each change their own receipt, and both versions are true. Editing a published layout instead of appending the next one destroys the only evidence of what the paper said.',
  },
  'report.schedule': {
    policy: 'field-level',
    label: 'Report schedule',
    why: 'Two administrators can edit one schedule at once: a new receiver and a changed hour merge, and the same field changed twice is offered to a person — because a delivery list that quietly keeps one of two answers is a report somebody stops receiving without anybody deciding that.',
  },
  'report.run': {
    policy: 'append-only',
    label: 'Report run',
    why: 'A run is a fact: the file was rendered, sent to these people, and a receipt came back. It is appended and never corrected — a re-send is another run, and the two together are what shows a report that keeps failing to arrive.',
  },
  'message.notice': {
    policy: 'field-level',
    label: 'Notice or message',
    why: 'The text of a notice is written once, but its delivery state and the read receipts change as people open it. Two nodes updating different recipients of the same notice are both right.',
  },
  'portal.feedback': {
    policy: 'append-only',
    label: 'Patient feedback',
    why: 'Feedback is what a patient said. It is appended and never edited, and the acknowledgement that follows is a separate record, not a rewrite of the complaint.',
  },
  prescription: {
    policy: 'append-only',
    label: 'Prescription',
    why: 'A prescription was written by a named prescriber at a time and the pharmacy dispensed against it. The portal reads it; nothing in this app edits it.',
  },
  'lab.result': {
    policy: 'append-only',
    label: 'Released investigation result',
    why: 'A result is released to a patient, once, by a person. It is append-only because a released result that can be edited afterwards is a released result nobody can rely on.',
  },
};

/* ------------------------------------------------------------------ operations */

export interface Operation {
  /** `nodeId:seq` — the idempotency key. A replay of the same operation is dropped by the server. */
  id: string;
  /** The contract operation this write replays as, e.g. `createPatient`. Set by `enqueueContractOperation`. */
  operationId?: string;
  nodeId: string;
  seq: number;
  at: string;
  entity: EntityKind;
  /** Stable id of the record on both sides, e.g. a patient MRN or a bed id. */
  recordId: string;
  label: string;
  /** `set` for a field-level write, `append` for a new record, `claim` for an exclusive one. */
  op: 'set' | 'append' | 'claim';
  /** For `set`: the fields, with values. For `claim`: what was claimed, e.g. `{ bed: 'med-a-12' }`. */
  fields?: Record<string, string | number | null>;
  /** Set when the local node has no server connection: the write is applied locally and queued. */
  queuedAt?: string;
  actor: string;
  /** Branch/node that authored it, for the audit ledger. */
  node: string;
}

export type DrainOutcome = 'applied' | 'duplicate' | 'conflict' | 'refused' | 'deferred';

export interface DrainResult {
  operation: Operation;
  outcome: DrainOutcome;
  /** For a conflict: the field(s) that collided and both values. */
  conflict?: Conflict;
  /** For a refusal: why the server would not take it. */
  reason?: string;
}

export interface ConflictField {
  field: string;
  mine: string | number | null;
  theirs: string | number | null;
  mineAt: string;
  theirsAt: string;
}

export interface Conflict {
  id: string;
  entity: EntityKind;
  recordId: string;
  label: string;
  policy: ConflictPolicy;
  detectedAt: string;
  /** What the two sides disagree about, field by field. */
  fields: ConflictField[];
  /** Append-only fields are listed for information; they never need a decision. */
  merged: ConflictField[];
  /** Set for an exclusive conflict: the record the other node already holds. */
  heldBy?: string;
  resolution?: {
    at: string;
    by: string;
    choice: 'mine' | 'theirs' | 'manual' | 'reassigned';
    note: string;
    /** For `reassigned` on an exclusive conflict: the record this node takes instead, e.g. another free bed. */
    reassignTo?: string;
  };
}

/* ------------------------------------------------------------------ number blocks */

export interface NumberBlock {
  series: string;
  prefix: string;
  from: number;
  to: number;
  next: number;
  nodeId: string;
  exhaustedAt?: string;
}

/**
 * MRN and invoice numbers are reserved in blocks per node. Two nodes can therefore cut over without a
 * conversation, and a block that runs out is a visible shortage instead of a duplicate number — which is the one
 * failure a patient master cannot recover from.
 */
export const DEFAULT_BLOCKS: NumberBlock[] = [
  { series: 'MRN', prefix: 'SH-', from: 200_000, to: 200_499, next: 200_000, nodeId: 'edge-a' },
  { series: 'MRN-OFFLINE', prefix: 'SH-', from: 700_000, to: 700_999, next: 700_000, nodeId: 'edge-a' },
  { series: 'INVOICE', prefix: 'INV-20261014-', from: 400, to: 899, next: 400, nodeId: 'edge-a' },
];

/** How a block is referred to in the interface and in a warning: "SH-200000–SH-200499". */
export const blockLabel = (block: NumberBlock): string => `${block.prefix}${block.from}–${block.prefix}${block.to}`;

export function drawNumber(blocks: NumberBlock[], series: string): { number: string; block: NumberBlock } | { error: string } {
  const block = blocks.find((b) => b.series === series);
  if (!block) return { error: `No number block is reserved for ${series} on this node` };
  if (block.next > block.to) return { error: `The ${series} block (${blockLabel(block)}) is exhausted — reserve another block before registering anyone` };
  return { number: `${block.prefix}${block.next}`, block: { ...block, next: block.next + 1 } };
}

export const blockRemaining = (block: NumberBlock): number => Math.max(0, block.to - block.next + 1);
export const blockLow = (block: NumberBlock, threshold = 50): boolean => blockRemaining(block) < threshold;

/* ------------------------------------------------------------------ the engine */

export interface OutboxState {
  nodeId: string;
  /** Operations not yet accepted by the server, oldest first. */
  pending: Operation[];
  results: DrainResult[];
  conflicts: Conflict[];
  blocks: NumberBlock[];
  /** The record as this node believes it to be, after applying local writes. */
  local: Record<string, Record<string, string | number | null>>;
  /** What the server has confirmed. The difference between the two is what a rolled-back node would lose. */
  confirmed: Record<string, Record<string, string | number | null>>;
  seq: number;
  lastDrainAt?: string;
  lastError?: string;
}

export const initialOutbox = (nodeId = 'edge-a'): OutboxState => ({
  nodeId,
  pending: [],
  results: [],
  conflicts: [],
  blocks: DEFAULT_BLOCKS.map((b) => ({ ...b, nodeId })),
  local: {},
  confirmed: {},
  seq: 0,
});

/** A tiny deterministic clock so a drill reads the same way twice: minutes past midnight, 2026-10-14. */
export class DrillClock {
  constructor(private minutes = 9 * 60) {}
  now(): string {
    const m = ((this.minutes % 1440) + 1440) % 1440;
    return `2026-10-14 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  tick(minutes = 1): string {
    this.minutes += minutes;
    return this.now();
  }
}

/** Reserved-series allocation, so a queued registration never waits for the uplink to get its number. */
export function allocateMrn(state: OutboxState): { mrn: string; state: OutboxState } | { error: string } {
  const drawn = drawNumber(state.blocks, 'MRN');
  if ('error' in drawn) return drawn;
  return {
    mrn: drawn.number,
    state: { ...state, blocks: state.blocks.map((b) => (b.series === 'MRN' ? drawn.block : b)) },
  };
}

/** Queue a write made while the uplink is down. Applied locally immediately — the ward keeps working. */
export function enqueue(state: OutboxState, write: Omit<Operation, 'id' | 'nodeId' | 'seq' | 'queuedAt'>): OutboxState {
  const seq = state.seq + 1;
  const op: Operation = { ...write, id: `${state.nodeId}:${seq}`, nodeId: state.nodeId, seq, queuedAt: write.at };
  const local = applyLocally(state.local, op);
  return { ...state, seq, pending: [...state.pending, op], local };
}

function applyLocally(
  local: OutboxState['local'],
  op: Operation,
): OutboxState['local'] {
  const current = local[op.recordId] ?? {};
  if (op.op === 'set' && op.fields) return { ...local, [op.recordId]: { ...current, ...op.fields } };
  if (op.op === 'append') return { ...local, [op.recordId]: { ...current, ...(op.fields ?? {}), _appended: (Number(current._appended ?? 0) + 1) as number } };
  return { ...local, [op.recordId]: { ...current, ...(op.fields ?? {}) } };
}

/* ------------------------------------------------------ what the contract allows, and what it refuses */

const contractIndex = contractOperations as unknown as Record<string, OperationMeta>;

export interface ContractCapability {
  /** The operation's id in the OpenAPI contract, e.g. `createPatient`. */
  id: string;
  method: string;
  path: string;
  /** The record this operation touches, and therefore the conflict policy that applies to it. */
  entity: EntityKind | null;
  policy: ConflictPolicy | null;
  /** May this write be queued while the uplink is down and replayed later? */
  mayQueue: boolean;
  /** May the screen answer from the edge replica, stamping how old the answer is? */
  servesFromReplica: boolean;
  /** Must the action be refused when there is no connection? */
  needsNetwork: boolean;
  /** The sentence the desk is shown when the app refuses the action — the contract's words, not ours. */
  because: string | null;
  audit: boolean;
}

/**
 * What the contract allows for one operation, or null when the id is not in the contract.
 *
 * This is deliberately a property of the *operation* and not of the queue: whether a write may be queued at all is
 * decided by the contract, so a screen can grey out an action that cannot be queued with no connection, before
 * anyone taps it, rather than letting them find out afterwards.
 */
export function capabilityOf(operationId: string): ContractCapability | null {
  const meta = contractIndex[operationId];
  if (!meta) return null;
  const entity = (meta.entity ?? null) as EntityKind | null;
  return {
    id: operationId,
    method: meta.method,
    path: meta.path,
    entity,
    policy: entity ? ENTITY_POLICY[entity]?.policy ?? null : null,
    mayQueue: meta.mayQueue === true,
    servesFromReplica: meta.servesFromReplica === true,
    needsNetwork: meta.needsNetwork === true,
    because: meta.because ?? null,
    audit: meta.audit === true,
  };
}

/**
 * How a contract operation is written into the outbox, derived from the contract rather than from a list kept
 * beside it: a read is never queued, a correction is a field-level `set`, a claim on an exclusive record is a
 * `claim` (a bed, a dose, an appointment slot), and anything else is an `append` — an event that happened.
 */
export function opKindFor(operationId: string): Operation['op'] | null {
  const capability = capabilityOf(operationId);
  if (!capability) return null;
  if (capability.method === 'get') return null;
  if (capability.method === 'patch' || capability.method === 'put') return 'set';
  return capability.policy === 'exclusive' ? 'claim' : 'append';
}

export type QueueOutcome =
  | { queued: true; operation: Operation }
  | { queued: false; operationId: string; because: string };

/**
 * Queue a write for a named contract operation.
 *
 * The operation decides the entity, the policy, the kind of write and whether it may be queued at all — which is
 * the whole point of P0-306. A screen that calls `enqueue` directly is still free to, but it is asserting those
 * four things itself; a screen that calls this one is asking the contract.
 */
export function enqueueContractOperation(
  state: OutboxState,
  operationId: string,
  write: { at: string; recordId: string; label: string; fields?: Record<string, string | number | null>; actor: string; node: string },
): { state: OutboxState; outcome: QueueOutcome } {
  const capability = capabilityOf(operationId);
  if (!capability) {
    return {
      state,
      outcome: {
        queued: false,
        operationId,
        because: `${operationId} is not an operation in the platform API contract, so there is nothing for a replay to send. The write was not queued.`,
      },
    };
  }
  if (capability.needsNetwork) {
    return {
      state,
      outcome: {
        queued: false,
        operationId,
        because: capability.because ?? `${operationId} has to reach the cloud tier, so it cannot be queued offline.`,
      },
    };
  }
  const op = opKindFor(operationId);
  if (!op || !capability.entity) {
    return {
      state,
      outcome: { queued: false, operationId, because: `${operationId} is a read, and a read is answered from the replica rather than queued.` },
    };
  }
  const next = enqueue(state, {
    at: write.at,
    recordId: write.recordId,
    label: write.label,
    actor: write.actor,
    node: write.node,
    entity: capability.entity,
    op,
    operationId,
    ...(write.fields ? { fields: write.fields } : {}),
  });
  return { state: next, outcome: { queued: true, operation: next.pending[next.pending.length - 1] } };
}

/** Every queued write, paired with what the contract says about it — what the sync console renders. */
export function waitingToSync(state: OutboxState): Array<{ operation: Operation; capability: ContractCapability | null }> {
  return state.pending.map((operation) => ({
    operation,
    capability: operation.operationId ? capabilityOf(operation.operationId) : null,
  }));
}

/* ---------------------------------------------------------------- the queue survives a reload */

/**
 * P0-306: a queue that forgets itself when the tab is reloaded is not a queue, it is a buffer — and the reload
 * happens exactly when a desk is busiest. The saved state is the queue, the conflicts, the number blocks and the
 * records this node believes it wrote; `dizi.` is the same prefix the shell already uses for density, locale and
 * the sidebar, so a technician clearing `dizi.*` clears the device rather than half of it.
 */
export const OUTBOX_STORAGE_KEY = 'dizi.outbox.v1';

export function serialiseOutbox(state: OutboxState): string {
  return JSON.stringify({
    version: 1,
    nodeId: state.nodeId,
    seq: state.seq,
    pending: state.pending,
    conflicts: state.conflicts,
    blocks: state.blocks,
    local: state.local,
    confirmed: state.confirmed,
    // Drain history is useful for a few minutes, not forever: the console shows the last 50 and the rest is a log.
    results: state.results.slice(0, 50),
    ...(state.lastDrainAt ? { lastDrainAt: state.lastDrainAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {}),
  });
}

const isOperation = (value: unknown): value is Operation => {
  const op = value as Operation | null;
  return Boolean(
    op &&
      typeof op === 'object' &&
      typeof op.id === 'string' &&
      typeof op.label === 'string' &&
      typeof op.at === 'string' &&
      typeof op.entity === 'string' &&
      op.entity in ENTITY_POLICY &&
      (op.op === 'set' || op.op === 'append' || op.op === 'claim'),
  );
};

/**
 * Read the saved queue back. Never throws: a device whose storage is corrupt, half-written or from a future
 * version starts with an empty queue and says so, because a ward desk that cannot open because of a parsing error
 * is a far worse outcome than a queue that has to be typed again.
 */
export function rehydrateOutbox(raw: string | null | undefined, nodeId = 'edge-a'): { state: OutboxState; note?: string } {
  if (!raw) return { state: initialOutbox(nodeId) };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { state: initialOutbox(nodeId), note: 'The queue saved on this device could not be read, so it started empty. Nothing was sent, and nothing was half-sent.' };
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || typeof parsed.seq !== 'number' || !Array.isArray(parsed.pending)) {
    return { state: initialOutbox(nodeId), note: 'The queue saved on this device was written by a different version, so it started empty.' };
  }

  const pending = parsed.pending.filter(isOperation);
  const droppedPending = parsed.pending.length - pending.length;
  const conflicts = Array.isArray(parsed.conflicts) ? (parsed.conflicts as Conflict[]) : [];
  const blocks = Array.isArray(parsed.blocks) && parsed.blocks.length ? (parsed.blocks as NumberBlock[]) : DEFAULT_BLOCKS.map((b) => ({ ...b, nodeId }));
  const notes = [
    droppedPending ? `${droppedPending} queued write(s) could not be read and were dropped — the rest of the queue is intact` : null,
  ].filter(Boolean) as string[];

  return {
    state: {
      nodeId: typeof parsed.nodeId === 'string' ? parsed.nodeId : nodeId,
      pending,
      results: Array.isArray(parsed.results) ? (parsed.results as DrainResult[]) : [],
      conflicts,
      blocks,
      local: (parsed.local ?? {}) as OutboxState['local'],
      confirmed: (parsed.confirmed ?? {}) as OutboxState['confirmed'],
      seq: parsed.seq,
      ...(typeof parsed.lastDrainAt === 'string' ? { lastDrainAt: parsed.lastDrainAt } : {}),
      ...(typeof parsed.lastError === 'string' ? { lastError: parsed.lastError } : {}),
    },
    ...(notes.length ? { note: notes.join('. ') } : {}),
  };
}

/**
 * Send a refused write again, as a new operation.
 *
 * A refusal means the server would not take it as it stood: a bed somebody else holds, a field somebody else
 * changed. Retrying it is a decision the desk makes — after moving the patient, or after correcting a value — so
 * this is a button in the queue, never a loop in the drain. The operation gets a fresh `nodeId:seq`: the old id is
 * spent, and a write resent under a spent id would be dropped as a duplicate of the refusal rather than looked at.
 */
export function requeueRefused(state: OutboxState, refusedId: string): { state: OutboxState; operation?: Operation; because?: string } {
  const result = state.results.find((r) => r.outcome === 'refused' && r.operation.id === refusedId);
  if (!result) return { state, because: 'That refusal is no longer in the history, so there is nothing to send again.' };

  const previous = result.operation;
  if (previous.operationId && !capabilityOf(previous.operationId)?.mayQueue) {
    return {
      state,
      because: capabilityOf(previous.operationId)?.because ?? `${previous.operationId} cannot be queued, so sending it again would fail the same way.`,
    };
  }

  const seq = state.seq + 1;
  const operation: Operation = { ...previous, id: `${state.nodeId}:${seq}`, nodeId: state.nodeId, seq, queuedAt: previous.at };
  return {
    state: {
      ...state,
      seq,
      pending: [...state.pending, operation],
      local: applyLocally(state.local, operation),
      // The refusal stays in the history — it happened, and it is why this one exists — and `lastError` is cleared
      // because the desk has just dealt with it.
      lastError: undefined,
    },
    operation,
  };
}

/* ------------------------------------------------------------------ the server side */

export interface ServerRecord {
  id: string;
  entity: EntityKind;
  fields: Record<string, string | number | null>;
  /** Field → the operation that last wrote it. This is how a real conflict is detected: not the value, the writer. */
  writers: Record<string, { opId: string; nodeId: string; at: string; actor: string }>;
  /** For an exclusive record: the operation holding it and the node that owns it. */
  claimedBy?: string;
  appended: number;
}

export class SimulatedCloud {
  records = new Map<string, ServerRecord>();
  applied = new Set<string>();
  /** When false the drill is offline: the drain is deferred rather than failed. */
  reachable = true;
  /** Nodes whose writes are held back, to create the "they wrote it first" half of a conflict. */
  readonly otherNode: string;

  constructor(otherNode = 'edge-b') {
    this.otherNode = otherNode;
  }

  /** A write that arrived from another branch while this node was offline. */
  writeFrom(node: string, entity: EntityKind, recordId: string, label: string, fields: Record<string, string | number | null>, at: string): void {
    const record = this.records.get(recordId) ?? { id: recordId, entity, fields: {}, writers: {}, appended: 0 };
    for (const [field, value] of Object.entries(fields)) {
      record.fields[field] = value;
      record.writers[field] = { opId: `${node}:remote`, nodeId: node, at, actor: 'the other branch' };
    }
    record.appended += 1;
    this.records.set(recordId, record);
  }

  hold(recordId: string, holder: string): void {
    const record = this.records.get(recordId) ?? { id: recordId, entity: 'bed.state' as EntityKind, fields: {}, writers: {}, appended: 0 };
    record.claimedBy = holder;
    this.records.set(recordId, record);
  }

  drain(operations: Operation[]): { results: DrainResult[]; records: Map<string, ServerRecord> } {
    const results: DrainResult[] = [];
    if (!this.reachable) {
      return { results: operations.map((operation) => ({ operation, outcome: 'deferred' as DrainOutcome, reason: 'The cloud is not reachable — the queue stays where it is' })), records: this.records };
    }

    for (const operation of operations) {
      // 1. idempotency: an operation already applied is dropped, not replayed
      if (this.applied.has(operation.id)) {
        results.push({ operation, outcome: 'duplicate', reason: 'Already applied — the queue was drained twice after a reconnect' });
        continue;
      }

      const policy = ENTITY_POLICY[operation.entity].policy;
      const record = this.records.get(operation.recordId) ?? { id: operation.recordId, entity: operation.entity, fields: {}, writers: {}, appended: 0 };

      // 2. exclusive records: the first claim stands, and the second is refused with something a person can act on
      if (policy === 'exclusive') {
        if (record.claimedBy && record.claimedBy !== operation.nodeId) {
          results.push({
            operation,
            outcome: 'refused',
            reason: `Already held by ${record.claimedBy}`,
            conflict: {
              id: `cf-${operation.id}`,
              entity: operation.entity,
              recordId: operation.recordId,
              label: operation.label,
              policy,
              detectedAt: operation.at,
              fields: Object.entries(operation.fields ?? {}).map(([field, value]) => ({
                field,
                mine: value,
                theirs: record.fields[field] ?? null,
                mineAt: operation.at,
                theirsAt: record.writers[field]?.at ?? operation.at,
              })),
              merged: [],
              heldBy: record.claimedBy,
            },
          });
          continue;
        }
        record.claimedBy = record.claimedBy ?? operation.nodeId;
      }

      // 3. field-level: a collision matters only when both sides wrote the SAME field
      if (policy === 'field-level' && operation.fields) {
        const collide = Object.entries(operation.fields).filter(([field]) => {
          const writer = record.writers[field];
          return writer && writer.nodeId !== operation.nodeId && record.fields[field] !== operation.fields![field];
        });
        const mergedDifferentFields = Object.entries(operation.fields).filter(([field]) => {
          const writer = record.writers[field];
          return writer && writer.nodeId !== operation.nodeId && record.fields[field] === operation.fields![field];
        });

        if (collide.length > 0) {
          const conflict: Conflict = {
            id: `cf-${operation.id}`,
            entity: operation.entity,
            recordId: operation.recordId,
            label: operation.label,
            policy,
            detectedAt: operation.at,
            fields: collide.map(([field, value]) => ({
              field,
              mine: value,
              theirs: record.fields[field],
              mineAt: operation.at,
              theirsAt: record.writers[field]?.at ?? operation.at,
            })),
            merged: mergedDifferentFields.map(([field, value]) => ({ field, mine: value, theirs: record.fields[field], mineAt: operation.at, theirsAt: record.writers[field]?.at ?? operation.at })),
          };
          // The newer value stands while the conflict is open, so the record is never stale or half-written.
          for (const [field, value] of Object.entries(operation.fields)) {
            const existing = record.writers[field];
            const newer = !existing || operation.at >= existing.at;
            if (newer) {
              record.fields[field] = value;
              record.writers[field] = { opId: operation.id, nodeId: operation.nodeId, at: operation.at, actor: operation.actor };
            }
          }
          record.appended += 1;
          this.records.set(record.id, record);
          this.applied.add(operation.id);
          results.push({ operation, outcome: 'conflict', conflict, reason: 'Both sides changed the same field — the newer value stands until somebody decides' });
          continue;
        }
      }

      // 4. everything else applies
      for (const [field, value] of Object.entries(operation.fields ?? {})) {
        record.fields[field] = value;
        record.writers[field] = { opId: operation.id, nodeId: operation.nodeId, at: operation.at, actor: operation.actor };
      }
      record.appended += 1;
      this.records.set(record.id, record);
      this.applied.add(operation.id);
      results.push({ operation, outcome: 'applied' });
    }

    return { results, records: this.records };
  }
}

export function drain(state: OutboxState, cloud: SimulatedCloud, at: string): OutboxState {
  const { results } = cloud.drain(state.pending);
  const applied = results.filter((r) => r.outcome === 'applied' || r.outcome === 'conflict' || r.outcome === 'duplicate');
  const deferred = results.filter((r) => r.outcome === 'deferred');
  const refused = results.filter((r) => r.outcome === 'refused');

  const confirmed = { ...state.confirmed };
  for (const r of applied) confirmed[r.operation.recordId] = { ...(confirmed[r.operation.recordId] ?? {}), ...(r.operation.fields ?? {}) };

  return {
    ...state,
    // deferred work stays in the queue; refused work leaves it (it needs a decision, not a retry)
    pending: deferred.map((r) => r.operation),
    results: [...results, ...state.results].slice(0, 200),
    // A conflict is detected now — when the two versions met — not when the write was made.
    conflicts: [...results.filter((r) => r.conflict).map((r) => ({ ...r.conflict!, detectedAt: at })), ...state.conflicts],
    confirmed,
    lastDrainAt: at,
    lastError: refused.length ? `${refused.length} write(s) were refused — they need a decision, not a retry` : undefined,
  };
}

/* ------------------------------------------------------------------ what the shell reads */

export function pendingAge(state: OutboxState, nowMinutes: number): { count: number; oldestMinutes: number | null; oldest: string | null } {
  if (state.pending.length === 0) return { count: 0, oldestMinutes: null, oldest: null };
  const minutes = state.pending.map((op) => nowMinutes - clockToMinutes(op.at.slice(11)));
  const oldestIndex = minutes.indexOf(Math.max(...minutes));
  return { count: state.pending.length, oldestMinutes: minutes[oldestIndex], oldest: state.pending[oldestIndex].label };
}

export const clockToMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function resolveConflict(state: OutboxState, conflictId: string, choice: NonNullable<Conflict['resolution']>, cloud: SimulatedCloud): OutboxState {
  const conflict = state.conflicts.find((c) => c.id === conflictId);
  if (!conflict) return state;
  const record = cloud.records.get(conflict.recordId);
  const local = { ...state.local };
  const confirmed = { ...state.confirmed };

  if (choice.choice === 'reassigned' && choice.reassignTo) {
    // The record stays with whoever held it; this node's write moves to another record (another bed, another
    // counter). Nothing is taken from the other branch and nothing is lost here — that is the whole point of
    // refusing an exclusive claim rather than merging it.
    const targetId = choice.reassignTo;
    const target = cloud.records.get(targetId) ?? { id: targetId, entity: conflict.entity, fields: {}, writers: {}, appended: 0 };
    for (const f of conflict.fields) {
      if (f.mine === null) continue;
      target.fields[f.field] = f.mine;
      target.writers[f.field] = { opId: `resolved:${conflictId}`, nodeId: state.nodeId, at: choice.at, actor: choice.by };
    }
    target.claimedBy = state.nodeId;
    target.appended += 1;
    cloud.records.set(target.id, target);
    local[targetId] = { ...(local[targetId] ?? {}), ...target.fields };
    confirmed[targetId] = { ...(confirmed[targetId] ?? {}), ...target.fields };
    // This node now knows the record it lost: the other branch's version is the truth, and our write lives on
    // the record we took instead.
    if (record) {
      local[conflict.recordId] = { ...record.fields };
      confirmed[conflict.recordId] = { ...record.fields };
    }
  } else if (record) {
    for (const f of conflict.fields) {
      const value = choice.choice === 'mine' ? f.mine : choice.choice === 'theirs' ? f.theirs : record.fields[f.field];
      record.fields[f.field] = value;
      record.writers[f.field] = { opId: `resolved:${conflictId}`, nodeId: state.nodeId, at: choice.at, actor: choice.by };
    }
    cloud.records.set(record.id, record);
    local[record.id] = { ...(local[record.id] ?? {}), ...record.fields };
    confirmed[record.id] = { ...(confirmed[record.id] ?? {}), ...record.fields };
  }

  return {
    ...state,
    conflicts: state.conflicts.map((c) => (c.id === conflictId ? { ...c, resolution: choice } : c)),
    local,
    confirmed,
  };
}

export function syncSummary(state: OutboxState) {
  const open = state.conflicts.filter((c) => !c.resolution);
  return {
    pending: state.pending.length,
    applied: state.results.filter((r) => r.outcome === 'applied').length,
    duplicates: state.results.filter((r) => r.outcome === 'duplicate').length,
    refused: state.results.filter((r) => r.outcome === 'refused').length,
    conflictsOpen: open.length,
    conflictsResolved: state.conflicts.length - open.length,
    /**
     * A record this node believes but the server has never confirmed — what a device lost under the bed would
     * lose. Only the fields this node wrote count, and the append counters (prefixed `_`) are bookkeeping.
     */
    unconfirmed: Object.keys(state.local).filter((id) => {
      const mine = state.local[id];
      const theirs = state.confirmed[id] ?? {};
      return Object.keys(mine).some((field) => !field.startsWith('_') && mine[field] !== theirs[field]);
    }).length,
  };
}

/* ------------------------------------------------------------------ the drill */

export interface DrillStep {
  at: string;
  text: string;
  tone: 'info' | 'success' | 'warning' | 'critical';
}

export interface DrillResult {
  steps: DrillStep[];
  state: OutboxState;
  summary: ReturnType<typeof syncSummary>;
  /** The plan's exit criterion: no write lost across the outage. */
  lostWrites: number;
}

/**
 * The outage drill from the plan, run in code: the uplink goes down mid-shift, the ward keeps working, a second
 * branch edits the same two records while we are dark, and the queue drains when the link returns. It asserts its
 * own result — `lostWrites` must be zero, and every conflict must be on the reconciliation list.
 */
export function runOutageDrill(): DrillResult {
  const clock = new DrillClock(9 * 60 + 40);
  const cloud = new SimulatedCloud('edge-b');
  let state = initialOutbox('edge-a');
  const steps: DrillStep[] = [];

  // Before the outage: two writes with the uplink up, so the baseline is confirmed at the server.
  state = enqueue(state, { at: clock.now(), entity: 'nursing.note', recordId: 'med-a-12', label: 'Note for bed A-12', op: 'append', fields: { note: 'Observations four-hourly, chest clear.' }, actor: 'S. Sultana', node: 'Medicine Ward A' });
  state = drain(state, cloud, clock.now());
  steps.push({ at: clock.now(), text: 'Uplink up: the note for bed A-12 was accepted and confirmed.', tone: 'success' });

  // The uplink goes down.
  cloud.reachable = false;
  clock.tick(6);
  steps.push({ at: clock.now(), text: 'Uplink lost. The ward does not stop: writes are applied locally and queued.', tone: 'warning' });

  // The ward keeps charting.
  state = enqueue(state, { at: clock.tick(4), entity: 'observation', recordId: 'adm-1041', label: 'Observation set for A-12 (NEWS 6)', op: 'append', fields: { respRate: 24, spo2: 93, temperature: 38.2, systolic: 104, pulse: 108, score: 6 }, actor: 'N. Haque', node: 'Medicine Ward A' });
  state = enqueue(state, { at: clock.tick(3), entity: 'mar.dose', recordId: 'mar-8821', label: 'Morphine 10 mg for A-12, 14:00', op: 'claim', fields: { dose: 'Given', witness: 'N. Haque' }, actor: 'S. Sultana', node: 'Medicine Ward A' });
  state = enqueue(state, { at: clock.tick(5), entity: 'nursing.note', recordId: 'med-a-12', label: 'Escalation note for A-12', op: 'append', fields: { note: 'Registrar at the bedside; oxygen started at 2 litres.' }, actor: 'S. Sultana', node: 'Medicine Ward A' });
  const allocation = allocateMrn(state);
  if ('error' in allocation) throw new Error(allocation.error);
  state = allocation.state;
  state = enqueue(state, { at: clock.tick(2), entity: 'patient.demographic', recordId: allocation.mrn, label: `Registration ${allocation.mrn} (offline block)`, op: 'append', fields: { name: 'Rahim Uddin', age: 61, sex: 'Male', phone: '01711998877' }, actor: 'Reception', node: 'OPD desk' });
  state = enqueue(state, { at: clock.tick(4), entity: 'patient.contact', recordId: 'SH-102311', label: 'Phone corrected at the desk', op: 'set', fields: { phone: '01711223344' }, actor: 'Reception', node: 'OPD desk' });
  state = enqueue(state, { at: clock.tick(3), entity: 'bed.state', recordId: 'med-a-19', label: 'Admit into bed A-19', op: 'claim', fields: { admitted: 'SH-103902' }, actor: 'Ward desk', node: 'Medicine Ward A' });
  state = enqueue(state, { at: clock.tick(2), entity: 'payment', recordId: 'rc-8841', label: 'Cash 1 200 received at the counter', op: 'append', fields: { amount: 1200, method: 'Cash' }, actor: 'Billing', node: 'Billing counter' });
  state = enqueue(state, { at: clock.tick(6), entity: 'patient.demographic', recordId: 'SH-104088', label: 'Age corrected for SH-104088', op: 'set', fields: { age: 44 }, actor: 'Reception', node: 'OPD desk' });

  const age = pendingAge(state, clockToMinutes(clock.now().slice(11)));
  steps.push({ at: clock.now(), text: `${age.count} writes queued, the oldest ${age.oldestMinutes} minutes old — all of them already applied on this device.`, tone: 'warning' });

  // Another branch edits the same two records while we are dark: one different field, one the same field.
  cloud.writeFrom('edge-b', 'patient.contact', 'SH-102311', 'Phone at Uttara', { address: 'House 12, Sector 7, Uttara' }, '2026-10-14 14:02');
  cloud.writeFrom('edge-b', 'patient.demographic', 'SH-104088', 'Age at Uttara', { age: 47 }, '2026-10-14 14:05');
  // …and takes the same bed the ward desk just admitted into.
  cloud.hold('med-a-19', 'edge-b');
  steps.push({ at: clock.now(), text: 'Uttara Branch changed the same two records and took bed A-19 while this node was offline.', tone: 'info' });

  // The link comes back.
  cloud.reachable = true;
  clock.tick(3);
  state = drain(state, cloud, clock.now());
  const summary = syncSummary(state);
  steps.push({
    at: clock.now(),
    text: `Uplink restored: ${summary.applied} write(s) applied, ${summary.duplicates} duplicate(s) dropped, ${summary.refused} refused, ${summary.conflictsOpen} conflict(s) for a person.`,
    tone: 'success',
  });
  for (const conflict of state.conflicts.filter((c) => !c.resolution)) {
    steps.push({
      at: conflict.detectedAt,
      text: `${ENTITY_POLICY[conflict.entity].label} · ${conflict.recordId}: ${conflict.fields.map((f) => `${f.field} “${f.mine}” here vs “${f.theirs}” there`).join('; ')}${conflict.heldBy ? ` — already held by ${conflict.heldBy}` : ''}`,
      tone: conflict.policy === 'exclusive' ? 'critical' : 'warning',
    });
  }

  // A person settles them: the desk keeps the local phone number, and the bed conflict is reassigned.
  for (const conflict of state.conflicts.filter((c) => !c.resolution)) {
    const isBed = conflict.policy === 'exclusive';
    state = resolveConflict(
      state,
      conflict.id,
      isBed
        ? {
            at: clock.tick(2),
            by: 'Ward desk — Main Campus',
            choice: 'reassigned',
            reassignTo: 'med-a-21',
            note: 'The patient went into bed A-21 instead; Uttara Branch keeps A-19.',
          }
        : {
            at: clock.tick(2),
            by: 'Reception — Main Campus',
            choice: 'mine',
            note: 'The desk read the number back to the patient, and kept the value they gave.',
          },
      cloud,
    );
  }
  steps.push({ at: clock.now(), text: 'Every conflict settled with a name and a note; the losing values stay on the record.', tone: 'success' });

  const finalSummary = syncSummary(state);
  // Every operation this node created is either applied, dropped as a duplicate, refused with a decision on the
  // list, or still queued. Anything else is a lost write, and the drill fails on it.
  const accounted = state.results.filter((r) => r.outcome !== 'deferred').length;
  const lost = state.seq - accounted - finalSummary.pending;
  return { steps, state, summary: finalSummary, lostWrites: Math.max(0, lost) };
}
