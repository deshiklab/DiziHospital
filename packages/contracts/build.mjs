#!/usr/bin/env node
/**
 * DiziHospital platform API client — generator (P0-207: "OpenAPI published to packages/contracts; generated TS
 * client builds").
 *
 * Source of truth: packages/contracts/openapi.json (the contract itself, guarded by check.mjs).
 * Outputs (packages/contracts/dist):
 *   capabilities.json   the projection the app and the API service read: per operation, what it may be asked
 *                       offline, which tier owns the record, whether it needs an idempotency key, and the
 *                       sentence staff are shown when it refuses — plus the entity policies, the drain
 *                       outcomes, the problem types and the duplicate rules, copied verbatim.
 *   client.ts           typed client: an interface per schema, the operations as a const map, and the small set
 *                       of decisions worth having in code rather than in prose.
 *
 * Usage:
 *   node build.mjs            write the artefacts
 *   node build.mjs --check    verify the artefacts on disk match the contract (CI drift gate)
 *
 * No dependencies, deliberately: a generator that cannot itself drift is the only kind that keeps a contract
 * honest. `--check` runs in the no-install verify job, which is why it must never grow one.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = process.env.CONTRACT_SOURCE ?? join(here, 'openapi.json');
const outDir = join(here, 'dist');
const checkOnly = process.argv.includes('--check');

const doc = JSON.parse(readFileSync(source, 'utf8'));
const version = doc.info?.version ?? '0.0.0';
const title = doc.info?.title ?? 'DiziHospital platform API';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const operations = [];
for (const [path, item] of Object.entries(doc.paths ?? {})) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const meta = op['x-dizi'] ?? {};
    const responses = op.responses ?? {};
    const schemaOf = (response) => {
      const media = response?.content?.['application/json'];
      const ref = media?.schema?.$ref;
      return ref ? ref.replace('#/components/schemas/', '') : null;
    };
    operations.push({
      id: op.operationId,
      method,
      path,
      tag: (op.tags ?? [])[0] ?? null,
      summary: op.summary ?? null,
      entity: meta.entity ?? null,
      offline: meta.offline ?? null,
      authority: meta.authority ?? null,
      idempotency: meta.idempotency ?? null,
      audit: meta.audit === true,
      because: meta.because ?? null,
      notes: meta.notes ?? null,
      request: schemaOf(op.requestBody ?? null),
      responses: Object.fromEntries(Object.keys(responses).map((code) => [code, schemaOf(responses[code])])),
      problemResponses: Object.keys(responses).filter((code) => responses[code]?.content?.['application/problem+json']),
      statuses: Object.keys(responses).map(Number).sort((a, b) => a - b),
      // Derived once, here, so no consumer has to re-interpret `offline` and get it subtly wrong.
      mayQueue: meta.offline === 'queue',
      servesFromReplica: meta.offline === 'cache',
      needsNetwork: meta.offline === 'online-only',
      requiresIdempotencyKey: meta.idempotency === 'required',
    });
  }
}

const operationIds = operations.map((o) => o.id);
const byEntity = {};
for (const op of operations) {
  if (!op.entity) continue;
  (byEntity[op.entity] ??= []).push(op.id);
}
const entities = doc['x-dizi-entities'] ?? {};
const idempotencyHeader = (doc.components?.parameters?.IdempotencyKey ?? {}).name ?? 'Idempotency-Key';

const capabilities = {
  contract: {
    title,
    version,
    openapi: doc.openapi,
    source: 'packages/contracts/openapi.json',
  },
  generatedBy: 'packages/contracts/build.mjs',
  operations: Object.fromEntries(operations.map((op) => [op.id, op])),
  operationOrder: operationIds,
  byEntity,
  queueable: operations.filter((o) => o.mayQueue).map((o) => o.id),
  servedFromReplica: operations.filter((o) => o.servesFromReplica).map((o) => o.id),
  onlineOnly: operations.filter((o) => o.needsNetwork).map((o) => o.id),
  idempotencyHeader: {
    name: idempotencyHeader,
    requiredOn: operations.filter((o) => o.requiresIdempotencyKey).map((o) => o.id),
  },
  entities,
  drainOutcomes: doc['x-dizi-drain-outcomes'] ?? {},
  problemTypes: doc['x-dizi-problem-types'] ?? {},
  duplicateRules: doc['x-dizi-duplicate-rules'] ?? {},
  conventions: doc['x-dizi-conventions'] ?? {},
};

/* ------------------------------------------------------------------- TypeScript */

const TS_PRIMITIVES = { string: 'string', integer: 'number', number: 'number', boolean: 'boolean', null: 'null' };
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Collapse a description to one line so it can sit in a JSDoc comment without breaking the file. */
function doc1(text) {
  if (!text) return null;
  return String(text).replace(/\s+/g, ' ').replace(/\*\//g, '*\\/').trim();
}

function jsdoc(text, indent = '') {
  const line = doc1(text);
  if (!line) return '';
  return `${indent}/** ${line} */\n`;
}

/** A schema, or a reference to one, as a TypeScript type. */
function tsType(schema) {
  if (!schema) return 'unknown';
  if (schema.$ref) return schema.$ref.replace('#/components/schemas/', '');
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (schema.type === 'array') return `Array<${tsType(schema.items)}>`;
  if (schema.type === 'object' || schema.properties) {
    // An inline object type: only its index signature matters to a client.
    if (schema.additionalProperties) {
      const inner = schema.additionalProperties === true ? 'unknown' : tsType(schema.additionalProperties);
      return `Record<string, ${inner}>`;
    }
    const props = Object.entries(schema.properties ?? {});
    if (!props.length) return 'Record<string, unknown>';
    return `{ ${props.map(([name, p]) => `${IDENTIFIER.test(name) ? name : JSON.stringify(name)}: ${tsType(p)}`).join('; ')} }`;
  }
  return TS_PRIMITIVES[schema.type] ?? 'unknown';
}

/** One interface per named schema. Optionality comes from `required`, never from guesswork. */
function emitInterface(name, schema) {
  if (schema.type !== 'object' || !schema.properties) {
    return `${jsdoc(schema.description)}export type ${name} = ${tsType(schema)};\n`;
  }
  const required = new Set(schema.required ?? []);
  const props = Object.entries(schema.properties);
  const lines = props.map(([prop, p]) => {
    const key = IDENTIFIER.test(prop) ? prop : JSON.stringify(prop);
    const optional = required.has(prop) ? '' : '?';
    return `${jsdoc(p.description, '  ')}  readonly ${key}${optional}: ${tsType(p)};`;
  });
  const additional = schema.additionalProperties;
  if (additional) {
    const inner = additional === true ? 'unknown' : tsType(additional);
    lines.push(`  readonly [key: string]: ${inner};`);
  }
  const header = `${jsdoc(schema.description)}export interface ${name} {\n`;
  return `${header}${lines.join('\n')}\n}\n`;
}

const interfaceOrder = Object.keys(doc.components?.schemas ?? {});

function emitClient() {
  const parts = [];
  parts.push(`/**
 * ${title} — generated client v${version}. DO NOT EDIT.
 *
 * Generated by packages/contracts/build.mjs from packages/contracts/openapi.json, checked by
 * \`npm run contract:check\`. Regenerate with \`npm run contract:build\`.
 *
 * This file is the contract's decisions in code: the operation metadata the offline queue is driven from, and
 * the four questions a screen actually asks — may I queue this, may I serve it from the replica, does it need
 * the network, and what do I tell the desk when it comes back refused.
 */`);

  parts.push('/* ------------------------------------------------------------------ schemas */');
  parts.push(interfaceOrder.map((name) => emitInterface(name, doc.components.schemas[name])).join('\n'));

  parts.push('/* ------------------------------------------------------------- operations */');
  parts.push(`export type OfflineCapability = ${[...new Set(operations.map((o) => o.offline))].map((v) => JSON.stringify(v)).join(' | ')};
export type Authority = ${[...new Set(operations.map((o) => o.authority))].map((v) => JSON.stringify(v)).join(' | ')};
export type Idempotency = ${[...new Set(operations.map((o) => o.idempotency))].map((v) => JSON.stringify(v)).join(' | ')};
export type EntityKind = keyof typeof entityPolicies;
export type DrainOutcome = keyof typeof drainOutcomes;

export interface OperationMeta {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly tag: string | null;
  readonly summary: string | null;
  /** The conflict policy that applies to this operation's record, or null for the platform endpoints. */
  readonly entity: EntityKind | null;
  /** cache: serve the read from the replica. queue: queue the write and replay it. online-only: refuse it, with a reason. */
  readonly offline: OfflineCapability;
  readonly authority: Authority;
  readonly idempotency: Idempotency;
  readonly audit: boolean;
  /** Shown to staff when the app refuses the action: the reason in their words, not an error code. */
  readonly because: string | null;
  /** Present on every online-only operation: why it cannot be queued. */
  readonly notes: string | null;
  readonly request: string | null;
  readonly responses: Readonly<Record<string, string | null>>;
  readonly problemResponses: readonly string[];
  readonly statuses: readonly number[];
  readonly mayQueue: boolean;
  readonly servesFromReplica: boolean;
  readonly needsNetwork: boolean;
  readonly requiresIdempotencyKey: boolean;
}`);

  const opEntries = operations.map((op) => {
    const j = (v) => JSON.stringify(v);
    const responses = `{ ${Object.entries(op.responses).map(([code, schema]) => `${j(code)}: ${schema ? JSON.stringify(schema) : 'null'}`).join(', ')} }`;
    return `  ${IDENTIFIER.test(op.id) ? op.id : j(op.id)}: {
    id: ${j(op.id)},
    method: ${j(op.method)},
    path: ${j(op.path)},
    tag: ${op.tag ? j(op.tag) : 'null'},
    summary: ${op.summary ? j(op.summary) : 'null'},
    entity: ${op.entity ? j(op.entity) : 'null'},
    offline: ${j(op.offline)},
    authority: ${j(op.authority)},
    idempotency: ${j(op.idempotency)},
    audit: ${op.audit},
    because: ${op.because ? j(op.because) : 'null'},
    notes: ${op.notes ? j(op.notes) : 'null'},
    request: ${op.request ? j(op.request) : 'null'},
    responses: ${responses},
    problemResponses: [${op.problemResponses.map((c) => j(c)).join(', ')}],
    statuses: [${op.statuses.join(', ')}],
    mayQueue: ${op.mayQueue},
    servesFromReplica: ${op.servesFromReplica},
    needsNetwork: ${op.needsNetwork},
    requiresIdempotencyKey: ${op.requiresIdempotencyKey},
  },`;
  }).join('\n');

  parts.push(`export const operations = {
${opEntries}
} as const satisfies Record<string, OperationMeta>;

export type OperationId = keyof typeof operations;
export type Operation = (typeof operations)[OperationId];`);

  parts.push(`/* --------------------------------------------------------------- the data */
/* The blocks below are the contract's own words, copied verbatim so a screen can render the rule it is enforcing
 * without a second list of rules kept in a component. */

export const entityPolicies = ${JSON.stringify(capabilities.entities, null, 2)} as const;

export const drainOutcomes = ${JSON.stringify(capabilities.drainOutcomes, null, 2)} as const;

export const problemTypes = ${JSON.stringify(capabilities.problemTypes, null, 2)} as const;

export const duplicateRules = ${JSON.stringify(capabilities.duplicateRules, null, 2)} as const;

export const contract = ${JSON.stringify(capabilities.contract, null, 2)} as const;`);

  parts.push(`/* ------------------------------------------------------------- decisions */

export function operation(id: OperationId): Operation {
  return operations[id];
}

/** May this write be queued while the uplink is down, and replayed later? */
export function mayQueue(id: OperationId): boolean {
  return operations[id].mayQueue;
}

/** May this read be answered from the edge replica, with the screen saying how old it is? */
export function servesFromReplica(id: OperationId): boolean {
  return operations[id].servesFromReplica;
}

/** Must this action be refused with an explanation when there is no connection? */
export function needsNetwork(id: OperationId): boolean {
  return operations[id].needsNetwork;
}

/** What to tell the desk when the app refuses an action, in their words. */
export function refusalReason(id: OperationId): string | null {
  return operations[id].because;
}

/** The conflict policy for a record, or null for something the contract does not model. */
export function policyFor(entity: string): 'field-level' | 'exclusive' | 'append-only' | null {
  const policy = (entityPolicies as Record<string, { policy?: string }>)[entity]?.policy;
  return policy === 'field-level' || policy === 'exclusive' || policy === 'append-only' ? policy : null;
}

/**
 * How a replayed write comes back, from the status and — for the two refusals that are decisions rather than
 * failures — the problem type. Total by construction: every status lands on one of the five outcomes, because a
 * drain that does not know what to do with an answer is a drain that drops writes.
 */
export function drainOutcomeFor(status: number, problemType?: string | null): DrainOutcome {
  if (problemType === 'dizi.duplicate-operation') return 'duplicate';
  if (status >= 200 && status < 300) return 'applied';
  if (status === 409) return 'conflict';
  if (status >= 400 && status < 500) return 'refused';
  // 5xx, including a bare 500: the server's problem, and the write is idempotent, so retrying it is safe.
  return 'deferred';
}

/** Every operation that writes to this entity — the ones whose conflict policy therefore applies. */
export function operationsFor(entity: EntityKind): readonly OperationId[] {
  return (Object.keys(operations) as OperationId[]).filter((id) => operations[id].entity === entity);
}`);

  return parts.join('\n\n') + '\n';
}

const artefacts = {
  'capabilities.json': JSON.stringify(capabilities, null, 2) + '\n',
  'client.ts': emitClient(),
};

/* ------------------------------------------------------------------ write */

if (checkOnly) {
  const drift = [];
  for (const [file, content] of Object.entries(artefacts)) {
    const target = join(outDir, file);
    if (!existsSync(target)) drift.push(`${file}: missing (run npm run contract:build)`);
    else if (readFileSync(target, 'utf8') !== content) drift.push(`${file}: out of date with packages/contracts/openapi.json`);
  }
  if (drift.length) {
    console.error('CONTRACT CLIENT DRIFT DETECTED\n' + drift.map((d) => '  - ' + d).join('\n'));
    process.exit(1);
  }
  console.log(`contract client up to date (${operations.length} operations, ${interfaceOrder.length} schemas, v${version})`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [file, content] of Object.entries(artefacts)) writeFileSync(join(outDir, file), content);
  console.log(`generated the client (${operations.length} operations, ${interfaceOrder.length} schemas, v${version}) into ${outDir}`);
}
