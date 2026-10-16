#!/usr/bin/env node
/**
 * Contract conformance (P0-207).
 *
 * `contracts/openapi.json` is the single source of truth for what the platform API accepts, what may be asked of
 * it while the uplink is down, and how two branches that disagree are reconciled. Two other things already believe
 * they know those answers: the web app, whose `lib/sync.ts` has been enforcing the conflict policies since P0-201,
 * and the API service, which has to satisfy the contract endpoint by endpoint.
 *
 * Those three drift apart silently unless something checks. This is that check. It does two jobs:
 *
 *   1. Shape — the document is one the API service can be built from and the client generated from: every `$ref`
 *      resolves, every operation carries complete `x-dizi` metadata, every queued write is idempotent, every
 *      deliberate online-only operation says why, and every failure is `application/problem+json`.
 *   2. Agreement — the policies in the contract are the policies the client has, entity by entity, and the
 *      contract's drain vocabulary is the client's drain vocabulary. A disagreement fails the build here rather
 *      than becoming a double-dose at 3am.
 *
 * It needs nothing installed, so it runs in the no-install `verify` job as well as anywhere else — and it lives
 * beside the contract it guards, the way `@dizi/tokens` checks its own generated output:
 *
 *     npm run contract:check                          # or: node packages/contracts/check.mjs
 *     npm run contract:test                           # or: node packages/contracts/check.mjs --self-test
 *
 *     --contract packages/contracts/openapi.json      # override either input
 *     --sync apps/web/lib/sync.ts
 *
 * `--self-test` mutates a copy of the contract in 33 ways and asserts that each mutation is caught. A
 * guardrail that cannot fail is not a guardrail, so the guardrail is itself tested.
 *
 * Exit code 0 when the contract conforms and agrees with the client, 1 otherwise.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const args = process.argv.slice(2);
const argFor = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const contractPath = resolve(root, argFor('contract', 'packages/contracts/openapi.json'));
const syncPath = resolve(root, argFor('sync', 'apps/web/lib/sync.ts'));

const OFFLINE = ['cache', 'queue', 'online-only'];
const AUTHORITY = ['edge', 'cloud'];
const IDEMPOTENCY = ['none', 'required'];
const MUTATING = ['post', 'put', 'patch', 'delete'];

/* The failure codes a built screen already depends on. A contract that drops one of these leaves a screen showing
 * a decision it cannot explain, so they are required by name, not by count. */
const REQUIRED_CODES = [
  'dizi.duplicate-patient',
  'dizi.duplicate-operation',
  'dizi.slot-taken',
  'dizi.bed-occupied',
  'dizi.dose-already-signed',
  'dizi.stale-version',
];

/* The duplicate-rule vocabulary is fixed in the contract, because a signal the API computes and a screen does not
 * know about is a rule that is documented and never applied. */
const DUPLICATE_SIGNALS = ['mrn', 'phone', 'name', 'dob', 'age', 'sex', 'nationalId', 'address', 'guardian'];

/* The role vocabulary. `x-dizi-roles` is what the realm, the app's navigation and the API's ability check all read
 * (P0-205, ticket #24), so a role the table does not declare is a token this platform refuses to act on. The nine
 * legacy roles are the acceptance line — a tenth is a decision nobody has argued for, and a missing one is a
 * person who can no longer sign in. */
const ABILITIES = ['read', 'write', 'administer'];
const SHELLS = ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'];
const LEGACY_ROLE_COUNT = 9;

/* The realm is authored beside the contract, and this is where the two are compared. A realm that has drifted from
 * the table — a renamed role, a client that no longer does PKCE, a missing forced enrolment — is a role that signs
 * in and is then refused, which is the worst of both. */
const REALM_PATH = 'infra/keycloak/realm-dizihospital.json';

/* ------------------------------------------------------------------ reading the client */

/** The conflict policies the client implements. A contract policy outside this set cannot be honoured yet. */
function readPolicyUnion(source) {
  const m = source.match(/export type ConflictPolicy =([\s\S]*?);/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** `EntityKind` — the entities the client is able to queue a write for. */
function readEntityKinds(source) {
  const m = source.match(/export type EntityKind =([\s\S]*?);/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** `ENTITY_POLICY` — per entity: the policy, the label, and the sentence shown to staff. */
function readEntityPolicy(source) {
  const start = source.indexOf('export const ENTITY_POLICY');
  if (start < 0) return null;
  const body = source.slice(start);
  const out = new Map();
  const re = /^\s{2}'?([a-z][a-z0-9.]*)'?:\s*\{\s*\n\s*policy:\s*'([^']+)',\s*\n\s*label:\s*'([^']*)',\s*\n\s*why:\s*'([^']*)',?\s*\n\s*\},/gm;
  for (const m of body.matchAll(re)) out.set(m[1], { policy: m[2], label: m[3], why: m[4] });
  return out;
}

/** The five ways a replayed write can come back. */
function readDrainOutcomes(source) {
  const m = source.match(/export type DrainOutcome =([\s\S]*?);/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * The Keycloak realm export, read for the facts this contract's role table makes promises about: which roles exist,
 * whether enrolment is forced, whether the clients are the ones the app and the API expect, and whether the mappers
 * put the branch, the node and the roles into the token. Absence is not a failure of this function — a checkout
 * without `infra/` reports it once, rather than nine times, and the caller says so.
 */
function readRealm(roles, fileExists, readFile, fail) {
  if (!fileExists(REALM_PATH)) {
    fail('x-dizi-roles', `x-dizi-roles names ${REALM_PATH} and it is not in the repository`);
    return {};
  }
  let realm;
  try {
    realm = JSON.parse(readFile(REALM_PATH));
  } catch (error) {
    fail(REALM_PATH, `is not valid JSON: ${error.message}`);
    return {};
  }

  const declared = (realm.roles?.realm ?? []).map((r) => r.name);
  const clients = (realm.clients ?? []).map((c) => c.clientId);
  for (const required of ['dizi-web', 'dizi-api']) {
    if (!clients.includes(required)) fail(REALM_PATH, `has no \`${required}\` client — the app and the API cannot both be served by this realm`);
  }

  const web = (realm.clients ?? []).find((c) => c.clientId === 'dizi-web') ?? {};
  if (web.publicClient !== true) fail(REALM_PATH, 'the `dizi-web` client must be public: a browser cannot keep a client secret, and a secret in a bundle is a secret published');
  if (web.attributes?.['pkce.code.challenge.method'] !== 'S256') {
    fail(REALM_PATH, 'the `dizi-web` client must require PKCE S256 — a public client without it lets an intercepted code be exchanged by anybody');
  }
  if (!(web.redirectUris ?? []).length) fail(REALM_PATH, 'the `dizi-web` client has no redirect URI, so no sign-in can return');

  const api = (realm.clients ?? []).find((c) => c.clientId === 'dizi-api') ?? {};
  if (api.bearerOnly !== true) fail(REALM_PATH, 'the `dizi-api` client must be bearer-only: it verifies tokens and never starts a login of its own');
  // The audience mapper lives on the client that *mints* the token, which is the staff app — a mapper on the
  // bearer-only client would never run, and the API would then have to accept any token from this realm.
  const audience = (realm.clients ?? []).some((c) =>
    (c.protocolMappers ?? []).some((m) => m.config?.['included.client.audience'] === 'dizi-api'));
  if (!audience) fail(REALM_PATH, 'no mapper puts `dizi-api` in the token audience — the API would accept a token minted for another client');

  const mappers = (web.protocolMappers ?? []).map((m) => m.name);
  for (const required of ['roles', 'branch', 'node']) {
    if (!mappers.includes(required)) fail(REALM_PATH, `no \`${required}\` mapper — the token has to carry it, or the app and the API have to guess`);
  }

  const requiredActions = realm.requiredActions ?? [];
  const totp = requiredActions.find((a) => a.providerId === 'CONFIGURE_TOTP');
  if (!totp?.enabled || totp?.defaultAction !== true) {
    fail(REALM_PATH, '`CONFIGURE_TOTP` must be enabled and a default action — enrolment is enforced by the realm, not requested by a screen');
  }
  if (Number(realm.otpPolicyDigits ?? 0) !== 6 || realm.otpPolicyType !== 'totp') {
    fail(REALM_PATH, 'the OTP policy must be TOTP with six digits, which is what the sign-in screen tells people to type');
  }
  if (realm.otpPolicyCodeReusable === true) {
    fail(REALM_PATH, 'a one-time code that can be used twice is not a second factor');
  }
  const policy = Array.isArray(realm.passwordPolicy) ? realm.passwordPolicy.join(' and ') : String(realm.passwordPolicy ?? '');
  if (!/(^|and\s+)failureFactor\(\d+\)/.test(policy)) {
    fail(REALM_PATH, 'no lockout in `passwordPolicy` — the sign-in screen promises a lockout after five failed attempts');
  }
  const policyLength = Number(policy.match(/(^|and\s+)length\((\d+)\)/)?.[2] ?? 0);
  if (policyLength < 12) {
    fail(REALM_PATH, `the password policy asks for ${policyLength || 'no'} characters; the hospital's own policy and the migration in ADR 0003 assume at least 12`);
  }
  const tokenLifespan = Number(realm.accessTokenLifespan ?? 0);
  if (!(tokenLifespan > 0 && tokenLifespan <= 600)) {
    fail(REALM_PATH, `access tokens live ${tokenLifespan}s; ADR 0003 asks for ten minutes or less, because a token that outlives the laptop it was issued to is a session nobody can end`);
  }
  /* The login theme. Keycloak ships no Bangla bundle, so the hospital's own sign-in page is a messages-only overlay
     in this repository — and if the realm points at a theme that is not here, the first screen a receptionist sees
     silently falls back to English. */
  const themePath = `infra/keycloak/themes/${realm.loginTheme}/login`;
  if (!fileExists(`${themePath}/theme.properties`)) {
    fail(REALM_PATH, `login theme \`${realm.loginTheme}\` has no ${themePath}/theme.properties — the realm would fall back to Keycloak's own English pages`);
  } else {
    const theme = readFile(`${themePath}/theme.properties`);
    for (const locale of realm.supportedLocales ?? []) {
      if (!fileExists(`${themePath}/messages/messages_${locale}.properties`) && locale !== 'en') {
        fail(`${themePath}/messages`, `the realm offers \`${locale}\` and the theme has no bundle for it — the realm would offer a language the page cannot speak`);
      }
    }
    if ((realm.supportedLocales ?? []).includes('bn') && !theme.includes('bn')) {
      fail(`${themePath}/theme.properties`, 'does not list `bn` in `locales`, so the Bangla bundle is never offered');
    }
    const banglaFile = `${themePath}/messages/messages_bn.properties`;
    if (fileExists(banglaFile)) {
      const bangla = readFile(banglaFile);
      const keys = bangla.split('\n').filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => l.split('=')[0].trim());
      if (keys.length < 40) fail(banglaFile, `carries ${keys.length} strings — too few to be a translated sign-in page`);
      /* A key that is not in Keycloak's own bundle renders nothing at all, which looks translated and is not. The
         upstream bundle cannot be read from here, so what is checked is the keys this repository knows about. */
      for (const required of ['doLogIn', 'username', 'password', 'loginOtpOneTime', 'invalidUserMessage', 'requiredAction.CONFIGURE_TOTP']) {
        if (!keys.includes(required)) fail(banglaFile, `is missing \`${required}\` — the sign-in page or the enrolment screen would still be English`);
      }
    }
  }

  if (!(realm.supportedLocales ?? []).includes('bn')) {
    fail(REALM_PATH, 'the staff desk is Bangla-first and the realm does not offer Bangla');
  }

  return { path: REALM_PATH, roles: declared, clients, theme: realm.loginTheme, locales: realm.supportedLocales ?? [] };
}

function readClient(source) {
  return {
    policies: readPolicyUnion(source),
    entities: readEntityKinds(source),
    entityPolicy: readEntityPolicy(source),
    drainOutcomes: readDrainOutcomes(source),
  };
}

/* ------------------------------------------------------------------ validation */

function resolvePointer(doc, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let node = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !(key in node)) return null;
    node = node[key];
  }
  return node;
}

function collectRefs(node, acc = []) {
  if (Array.isArray(node)) node.forEach((child) => collectRefs(child, acc));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') acc.push(value);
      else collectRefs(value, acc);
    }
  }
  return acc;
}

/**
 * Both jobs, in one pass, over a document and a client source. Returns errors, warnings and the tables the
 * report needs — never prints, so the self-test can run it against mutated copies.
 *
 * `options.caps`, `options.readFile` and `options.fileExists` are injectable so the self-test can lie about the
 * generated projection or a file that does not exist without touching disk.
 */
function validate(doc, syncSource, options = {}) {
  const readFile = options.readFile ?? ((path) => readFileSync(resolve(root, path), 'utf8'));
  const fileExists = options.fileExists ?? ((path) => {
    try {
      readFileSync(resolve(root, path));
      return true;
    } catch {
      return false;
    }
  });
  const errors = [];
  const warnings = [];
  const fail = (where, message) => errors.push({ where, message });
  const warn = (where, message) => warnings.push({ where, message });

  const client = readClient(syncSource);
  if (!client.policies) fail('client', 'could not find `export type ConflictPolicy`');
  if (!client.entities) fail('client', 'could not find `export type EntityKind`');
  if (!client.entityPolicy) fail('client', 'could not find `export const ENTITY_POLICY`');
  if (!client.drainOutcomes) fail('client', 'could not find `export type DrainOutcome`');
  if (client.entityPolicy && client.entities && client.entityPolicy.size !== client.entities.length) {
    fail('client', `parsed ${client.entityPolicy.size} ENTITY_POLICY entries for ${client.entities.length} EntityKind members — the parser or the file is out of step`);
  }

  if (!/^3\.1\./.test(doc.openapi ?? '')) fail('openapi', `expected a 3.1.x document, found ${JSON.stringify(doc.openapi)}`);
  if (!doc.info?.title) fail('info', 'missing `info.title`');
  if (!doc.info?.version) fail('info', 'missing `info.version`');
  if (!doc.info?.description) fail('info', 'missing `info.description` — the contract has to say what its metadata means');
  if (!Array.isArray(doc.servers) || doc.servers.length < 1) fail('servers', 'at least one server is required');
  if (!doc.paths || typeof doc.paths !== 'object' || !Object.keys(doc.paths).length) fail('paths', 'no paths');

  const declaredTags = new Set((doc.tags ?? []).map((t) => t.name));
  const entities = doc['x-dizi-entities'] ?? {};
  const drainOutcomes = doc['x-dizi-drain-outcomes'] ?? {};
  const problemTypes = doc['x-dizi-problem-types'] ?? {};

  for (const ref of new Set(collectRefs(doc))) {
    if (resolvePointer(doc, ref) === null) fail('$ref', `${ref} does not resolve`);
  }

  const operations = [];
  const operationIds = new Set();

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (typeof item !== 'object' || item === null) {
      fail(path, 'path item is not an object');
      continue;
    }
    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const shared = Array.isArray(item.parameters) ? item.parameters : [];

    for (const [method, op] of Object.entries(item)) {
      if (method === 'parameters' || method === 'summary' || method === 'description') continue;
      if (!MUTATING.includes(method) && method !== 'get') {
        fail(`${method.toUpperCase()} ${path}`, 'only get/post/put/patch/delete are supported by the generator');
        continue;
      }

      const where = `${method.toUpperCase()} ${path}`;
      const meta = op['x-dizi'];
      const params = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]
        .map((p) => (p?.$ref ? resolvePointer(doc, p.$ref) : p));

      if (!op.operationId) fail(where, 'missing `operationId`');
      else if (operationIds.has(op.operationId)) fail(where, `duplicate operationId \`${op.operationId}\``);
      else operationIds.add(op.operationId);

      if (!op.summary) fail(where, 'missing `summary`');
      if (!Array.isArray(op.tags) || op.tags.length === 0) fail(where, 'missing `tags`');
      else for (const tag of op.tags) if (!declaredTags.has(tag)) fail(where, `tag \`${tag}\` is not declared at the document root`);

      if (!meta || typeof meta !== 'object') {
        fail(where, 'missing `x-dizi` metadata');
        continue;
      }
      for (const key of ['entity', 'offline', 'authority', 'idempotency', 'audit', 'because']) {
        if (!(key in meta)) fail(where, `x-dizi.${key} is missing`);
      }
      if (meta.entity != null && meta.entity !== null && !(meta.entity in entities)) {
        fail(where, `x-dizi.entity \`${meta.entity}\` is not declared in x-dizi-entities`);
      }
      if (!OFFLINE.includes(meta.offline)) fail(where, `x-dizi.offline must be one of ${OFFLINE.join(' | ')}`);
      if (!AUTHORITY.includes(meta.authority)) fail(where, `x-dizi.authority must be one of ${AUTHORITY.join(' | ')}`);
      if (!IDEMPOTENCY.includes(meta.idempotency)) fail(where, `x-dizi.idempotency must be one of ${IDEMPOTENCY.join(' | ')}`);
      if (typeof meta.audit !== 'boolean') fail(where, 'x-dizi.audit must be a boolean');
      if (typeof meta.because !== 'string' || meta.because.length < 80 || !meta.because.trim().endsWith('.')) {
        fail(where, 'x-dizi.because must be a full sentence of at least 80 characters ending in a full stop — it is what staff read');
      }

      // The rules that make `offline` mean something.
      if (meta.offline === 'queue' && meta.idempotency !== 'required') {
        fail(where, 'a queued write must be idempotent — without a replay key a drain that runs twice writes twice');
      }
      if (meta.offline === 'queue' && !MUTATING.includes(method)) {
        fail(where, 'only a mutating operation may be queued');
      }
      if (meta.offline === 'cache' && method !== 'get') {
        fail(where, 'only a read may be served from the replica');
      }
      if (meta.offline === 'online-only' && !(typeof meta.notes === 'string' && meta.notes.trim())) {
        fail(where, 'an online-only operation must say why in `x-dizi.notes` — it is the one behaviour staff cannot work around');
      }
      if (meta.idempotency === 'required' && !params.some((p) => p?.name === 'Idempotency-Key' && p?.in === 'header')) {
        fail(where, 'idempotency is required, so the operation must declare the `Idempotency-Key` header');
      }

      for (const name of pathParams) {
        if (!params.some((p) => p?.name === name && p?.in === 'path' && p?.required === true)) {
          fail(where, `path parameter \`{${name}}\` is not declared`);
        }
      }
      for (const p of params) {
        if (!p || typeof p !== 'object') {
          fail(where, 'a parameter is not an object');
          continue;
        }
        if (p.in === 'path' && p.required !== true) fail(where, `path parameter \`${p.name}\` must be required`);
        if (p.in === 'query' && !p.schema) fail(where, `query parameter \`${p.name}\` has no schema`);
      }

      const responses = op.responses ?? {};
      const codes = Object.keys(responses);
      if (!codes.length) fail(where, 'no responses');
      if (!codes.some((c) => /^2\d\d$/.test(c))) fail(where, 'no success response');
      for (const [code, response] of Object.entries(responses)) {
        if (!response?.description) fail(where, `response ${code} has no description`);
        if (!/^2\d\d$/.test(code) && !response?.content?.['application/problem+json']) {
          fail(where, `response ${code} must be application/problem+json — the app parses the problem type, not prose`);
        }
        for (const media of Object.values(response?.content ?? {})) {
          if (!media?.schema) fail(where, `response ${code} has media with no schema`);
        }
      }
      if (MUTATING.includes(method)) {
        for (const code of ['401', '403']) {
          if (!(code in responses)) fail(where, `a write must document ${code} — the contract is where the role rules live`);
        }
      }

      operations.push({ where, method, path, meta, op });
    }
  }

  // An append-only record is a fact: it is appended, never corrected in place.
  for (const { where, method, meta } of operations) {
    if (entities[meta.entity]?.policy === 'append-only' && (method === 'patch' || method === 'put')) {
      fail(where, `\`${meta.entity}\` is append-only, so it cannot be corrected in place — append a reversing record instead`);
    }
  }

  /* Agreement with the client. */
  const policyTable = [];
  if (client.entities && client.entityPolicy) {
    for (const [entity, declared] of Object.entries(entities)) {
      if (!client.policies.includes(declared.policy)) {
        fail(`x-dizi-entities.${entity}`, `policy \`${declared.policy}\` is not one the client implements (${client.policies.join(' | ')})`);
        continue;
      }
      const clientEntry = client.entityPolicy.get(entity);
      if (clientEntry) {
        const agreed = clientEntry.policy === declared.policy;
        policyTable.push({ entity, contract: declared.policy, client: clientEntry.policy, state: agreed ? 'agreed' : 'disagreed' });
        if (!agreed) {
          fail(`x-dizi-entities.${entity}`, `policy disagrees with the client: contract says \`${declared.policy}\`, apps/web/lib/sync.ts says \`${clientEntry.policy}\``);
        }
        if (!declared.label) fail(`x-dizi-entities.${entity}`, 'missing `label`');
        if (!declared.why || declared.why.length < 40) {
          fail(`x-dizi-entities.${entity}`, '`why` must be a sentence of at least 40 characters — it is what staff read');
        }
      } else if (client.entities.includes(entity)) {
        fail(`x-dizi-entities.${entity}`, 'the client names this entity but declares no policy for it');
      } else {
        policyTable.push({ entity, contract: declared.policy, client: '—', state: 'ahead' });
        warn(`x-dizi-entities.${entity}`, 'declared in the contract and not yet in apps/web/lib/sync.ts — the client cannot queue this entity until it is');
      }
    }
    for (const entity of client.entities) {
      if (!(entity in entities)) {
        fail(`x-dizi-entities.${entity}`, 'the client can queue writes for this entity and the contract declares no policy for it');
      }
    }
  }

  // The drain vocabulary is the same five words on both sides.
  if (client.drainOutcomes) {
    for (const outcome of client.drainOutcomes) {
      if (!(outcome in drainOutcomes)) {
        fail(`x-dizi-drain-outcomes.${outcome}`, 'the client names this outcome and the contract does not say what produces it');
      }
    }
    for (const outcome of Object.keys(drainOutcomes)) {
      if (!client.drainOutcomes.includes(outcome)) {
        warn(`x-dizi-drain-outcomes.${outcome}`, 'declared in the contract and not in the client’s DrainOutcome union');
      }
    }
  }
  for (const [outcome, entry] of Object.entries(drainOutcomes)) {
    for (const key of ['status', 'meaning', 'client']) {
      if (!entry?.[key]) fail(`x-dizi-drain-outcomes.${outcome}`, `missing \`${key}\``);
    }
  }

  // The idempotency key convention is `nodeId:seq` on both sides, or a replay is not a replay.
  for (const [label, source] of [['contract', JSON.stringify(doc)], ['client', syncSource]]) {
    if (!source.includes('nodeId:seq')) {
      fail(label, `the ${label} does not state the idempotency key convention \`nodeId:seq\``);
    }
  }

  for (const code of REQUIRED_CODES) {
    if (!(code in problemTypes)) {
      fail(`x-dizi-problem-types.${code}`, 'required: a built screen depends on this failure being distinguishable');
    }
  }
  for (const [code, entry] of Object.entries(problemTypes)) {
    if (!/^dizi\.[a-z0-9.-]+$/.test(code)) {
      fail(`x-dizi-problem-types.${code}`, 'problem type codes are `dizi.` followed by lower-case words and dots');
    }
    for (const key of ['title', 'when', 'client']) {
      if (!entry?.[key]) fail(`x-dizi-problem-types.${code}`, `missing \`${key}\``);
    }
  }

  for (const key of ['idempotency', 'authority', 'conflictIsNotAnError', 'errors', 'audit']) {
    if (!doc['x-dizi-conventions']?.[key]) fail('x-dizi-conventions', `missing \`${key}\``);
  }

  /* The queue's state machine, published as data (P0-402). The service enforces it and the screens draw it, so it has
   * to be *total* and *closed*: every status the patch operation accepts is a key, every target is one of those statuses,
   * and the two finished states lead nowhere. A table with a hole in it is worse than no table — the screen reads it to
   * decide what to offer, so a missing key means a board that silently offers nothing for a state, and a target outside
   * the vocabulary is a button the service refuses. */
  const queueMoves = doc['x-dizi-scheduling']?.queueMoves;
  const statuses = doc.components?.schemas?.AppointmentPatch?.properties?.status?.enum ?? [];

  if (!queueMoves || typeof queueMoves !== 'object') {
    fail('x-dizi-scheduling', 'missing `queueMoves` — the queue is a state machine and the screens draw it');
  } else {
    for (const status of statuses) {
      if (!Array.isArray(queueMoves[status])) {
        fail('x-dizi-scheduling.queueMoves', `no entry for \`${status}\`, which the patch operation accepts — a hole in the table is a board that offers nothing from that state`);
      }
    }

    for (const [from, targets] of Object.entries(queueMoves)) {
      if (!statuses.includes(from)) {
        fail('x-dizi-scheduling.queueMoves', `\`${from}\` is not a status the patch operation accepts`);
      }
      if (!Array.isArray(targets)) {
        fail('x-dizi-scheduling.queueMoves', `\`${from}\` does not map to a list of moves`);
        continue;
      }
      if (new Set(targets).size !== targets.length) {
        fail('x-dizi-scheduling.queueMoves', `\`${from}\` lists a move twice — the refusal sentence would read badly`);
      }
      for (const to of targets) {
        if (!statuses.includes(to)) {
          fail('x-dizi-scheduling.queueMoves', `\`${from}\` may move to \`${to}\`, which is not a status the patch operation accepts`);
        }
      }
    }

    for (const finished of ['Cancelled', 'No show', 'Completed']) {
      if ((queueMoves[finished] ?? []).length) {
        fail('x-dizi-scheduling.queueMoves', `\`${finished}\` is finished and may move anywhere — a visit that is over is a record, not a state to be dragged out of`);
      }
    }

    /* Checking in is an operation rather than a move, and the contract says which states it applies from. Getting this
       list wrong is a desk that cannot check in the patient standing in front of it, or a patient queued who never
       arrived. */
    const checkInFrom = doc['x-dizi-scheduling'].checkInFrom;
    if (!Array.isArray(checkInFrom) || !checkInFrom.length) {
      fail('x-dizi-scheduling', 'missing `checkInFrom` — checking a patient in is an operation, and the states it applies from have to be published');
    } else {
      const impossible = ['Checked in', 'Waiting', 'In consultation', 'Completed', 'No show', 'Cancelled'];
      for (const status of checkInFrom) {
        if (!statuses.includes(status)) {
          fail('x-dizi-scheduling.checkInFrom', `\`${status}\` is not a status the patch operation accepts`);
        }
        if (impossible.includes(status)) {
          fail('x-dizi-scheduling.checkInFrom', `\`${status}\` cannot be checked in — either the patient is already in the queue or the visit is finished`);
        }
      }
    }
  }

  /* The ledger (P0-208). Its acceptance is that a tamper test fails as expected, which a chain only supports if
   * the entries carry the links — so if anything is audited, the entry schema has to be hash-chained. */
  const audited = operations.filter((o) => o.meta.audit === true).length;
  if (audited || 'audit' in entities) {
    const required = doc.components?.schemas?.AuditEntry?.required ?? [];
    for (const field of ['hash', 'prevHash']) {
      if (!required.includes(field)) {
        fail('components.schemas.AuditEntry', `the ledger is append-only and hash-chained (P0-208), so \`${field}\` is required — ${audited} operation${audited === 1 ? '' : 's'} write to it`);
      }
    }
  }

  /* The generated projection (P0-207). It is not a second contract — it is this one, projected. Anything that
   * paraphrases the contract instead of copying it goes stale in a way nobody notices until a desk is offline,
   * so the projection is checked against the contract rather than trusted. Its freshness is checked separately,
   * by `node build.mjs --check`. */
  const capsPath = 'packages/contracts/dist/capabilities.json';
  let caps = options.caps ?? null;
  if (!caps) {
    if (!fileExists(capsPath)) {
      fail(capsPath, 'missing — run `npm run contract:build`; the generated client is committed, so a checkout without it is a broken checkout');
    } else {
      try {
        caps = JSON.parse(readFile(capsPath));
      } catch (error) {
        fail(capsPath, `is not valid JSON: ${error.message}`);
      }
    }
  }

  if (caps) {
    const projected = caps.operations ?? {};
    const byId = new Map(operations.map((o) => [o.op.operationId, o]));
    for (const { meta, op, path, method } of operations) {
      const id = op.operationId;
      const entry = projected[id];
      if (!entry) {
        fail(capsPath, `operation \`${id}\` is missing from the generated projection`);
        continue;
      }
      for (const key of ['method', 'path', 'offline', 'authority', 'entity', 'idempotency']) {
        const expected = key === 'method' ? method : key === 'path' ? path : meta[key];
        if (entry[key] !== (expected ?? null)) {
          fail(`${capsPath}#${id}.${key}`, `is ${JSON.stringify(entry[key])} and the contract says ${JSON.stringify(expected ?? null)} — the projection paraphrases the contract instead of copying it`);
        }
      }
      if (entry.because !== (meta.because ?? null)) {
        fail(`${capsPath}#${id}.because`, 'does not match the contract verbatim — it is the sentence staff read, so it is copied, not rewritten');
      }
      const derived = [
        ['mayQueue', entry.offline === 'queue'],
        ['servesFromReplica', entry.offline === 'cache'],
        ['needsNetwork', entry.offline === 'online-only'],
        ['requiresIdempotencyKey', entry.idempotency === 'required'],
      ];
      for (const [flag, expected] of derived) {
        if (entry[flag] !== expected) fail(`${capsPath}#${id}.${flag}`, `is ${entry[flag]} while \`${flag === 'mayQueue' ? 'offline: queue' : flag === 'servesFromReplica' ? 'offline: cache' : flag === 'needsNetwork' ? 'offline: online-only' : 'idempotency: required'}\` implies ${expected}`);
      }
    }
    for (const id of Object.keys(projected)) {
      if (!byId.has(id)) fail(`${capsPath}#${id}`, 'is in the generated projection and not in the contract — the projection is generated, so this means it was edited by hand');
    }

    const derivedList = (predicate) => operations.filter(predicate).map((o) => o.op.operationId);
    const lists = [
      ['queueable', derivedList((o) => o.meta.offline === 'queue')],
      ['servedFromReplica', derivedList((o) => o.meta.offline === 'cache')],
      ['onlineOnly', derivedList((o) => o.meta.offline === 'online-only')],
    ];
    for (const [key, expected] of lists) {
      if (JSON.stringify(caps[key]) !== JSON.stringify(expected)) {
        fail(`${capsPath}.${key}`, `is ${JSON.stringify(caps[key])} and the contract implies ${JSON.stringify(expected)}`);
      }
    }
    const headerName = doc.components?.parameters?.IdempotencyKey?.name ?? null;
    if (caps.idempotencyHeader?.name !== headerName) {
      fail(`${capsPath}.idempotencyHeader.name`, `is ${JSON.stringify(caps.idempotencyHeader?.name)} and the contract declares ${JSON.stringify(headerName)}`);
    }
    const requiredOn = derivedList((o) => o.meta.idempotency === 'required');
    if (JSON.stringify(caps.idempotencyHeader?.requiredOn) !== JSON.stringify(requiredOn)) {
      fail(`${capsPath}.idempotencyHeader.requiredOn`, `is ${JSON.stringify(caps.idempotencyHeader?.requiredOn)} and the contract implies ${JSON.stringify(requiredOn)}`);
    }

    const usedEntities = [...new Set(operations.map((o) => o.meta.entity).filter(Boolean))];
    for (const entity of usedEntities) {
      const expected = derivedList((o) => o.meta.entity === entity);
      if (JSON.stringify(caps.byEntity?.[entity]) !== JSON.stringify(expected)) {
        fail(`${capsPath}.byEntity.${entity}`, `is ${JSON.stringify(caps.byEntity?.[entity])} and the operations on ${entity} are ${JSON.stringify(expected)}`);
      }
    }
    for (const entity of Object.keys(caps.byEntity ?? {})) {
      if (!usedEntities.includes(entity)) fail(`${capsPath}.byEntity.${entity}`, 'lists an entity no operation touches');
    }

    // The copied blocks have to be the contract's own words, not a summary of them.
    for (const [key, block] of [['entities', entities], ['drainOutcomes', drainOutcomes], ['problemTypes', problemTypes], ['duplicateRules', doc['x-dizi-duplicate-rules'] ?? {}], ['roles', doc['x-dizi-roles'] ?? {}]]) {
      if (JSON.stringify(caps[key]) !== JSON.stringify(block)) {
        fail(`${capsPath}.${key}`, 'differs from the contract — these blocks are copied verbatim so a screen can render the rule it is enforcing');
      }
    }

    // The drain mapping is total, or a drain drops writes it does not recognise.
    const statusText = Object.values(caps.drainOutcomes ?? {}).map((o) => String(o?.status ?? '')).join(' ');
    for (const [label, re] of [['2xx', /\b2(?:xx|\d\d)\b/], ['4xx', /\b4(?:xx|\d\d)\b/], ['5xx', /\b5(?:xx|\d\d)\b/]]) {
      if (!re.test(statusText)) {
        fail(`${capsPath}.drainOutcomes`, `no outcome covers ${label} — \`drainOutcomeFor\` in the generated client is total, so the contract has to say what ${label} means`);
      }
    }
  }

  /* The duplicate rules. P0-301's acceptance is that they are documented *and* tunable; the second half only
   * holds if the rules are the ones the product actually runs, so each rule names the files that implement it and
   * this checks that they still do. A rule nobody implements is a claim, not a rule. */
  const duplicateRules = doc['x-dizi-duplicate-rules'] ?? {};
  const ruleRows = [];
  const thresholds = duplicateRules.thresholds ?? {};
  for (const bound of ['warn', 'block']) {
    const value = thresholds[bound];
    if (typeof value !== 'number' || value < 0 || value > 1) {
      fail(`x-dizi-duplicate-rules.thresholds.${bound}`, 'must be a number between 0 and 1');
    }
  }
  if (typeof thresholds.warn === 'number' && typeof thresholds.block === 'number' && !(thresholds.warn < thresholds.block)) {
    fail('x-dizi-duplicate-rules.thresholds', '`warn` must be below `block` — otherwise every candidate is refused');
  }
  for (const key of ['description', 'configuredIn', 'combination']) {
    if (!duplicateRules[key]) fail(`x-dizi-duplicate-rules.${key}`, `missing \`${key}\` — the rule set has to say how it works and where it is tuned`);
  }

  const ruleIds = new Set();
  let clientRuleCount = 0;
  for (const rule of duplicateRules.rules ?? []) {
    const where = `x-dizi-duplicate-rules.${rule.id ?? '(no id)'}`;
    if (!rule.id) fail('x-dizi-duplicate-rules.rules', 'a rule has no `id`');
    else if (ruleIds.has(rule.id)) fail(where, 'duplicate rule id');
    else ruleIds.add(rule.id);
    if (rule.id && !/^[a-z]+(\.[a-z0-9-]+)+$/.test(rule.id)) fail(where, 'rule ids are lower-case words joined by dots');
    if (!DUPLICATE_SIGNALS.includes(rule.signal)) {
      fail(where, `signal \`${rule.signal}\` is not one of ${DUPLICATE_SIGNALS.join(' | ')}`);
    }
    if (typeof rule.weight !== 'number' || rule.weight < 0 || rule.weight > 1) fail(where, '`weight` must be a number between 0 and 1');
    if (typeof rule.veto !== 'boolean') fail(where, '`veto` must be a boolean');
    if (!rule.label) fail(where, 'missing `label`');
    if (!rule.when || rule.when.length < 40) fail(where, '`when` must be a sentence of at least 40 characters — it is what the reviewer reads');
    if (rule.veto === true && typeof rule.weight === 'number' && typeof thresholds.block === 'number' && rule.weight >= thresholds.block) {
      fail(where, 'a vetoing rule may not score at or above `block` — it would veto itself');
    }
    if (!Array.isArray(rule.evidence) || !rule.evidence.length) fail(where, 'needs `evidence`: the substrings that show the rule is still implemented');
    if (!Array.isArray(rule.implementedBy)) {
      fail(where, 'needs `implementedBy` — an array, empty when only the API computes the rule yet');
      continue;
    }
    let implemented = 0;
    for (const file of rule.implementedBy) {
      if (!fileExists(file)) {
        fail(where, `\`${file}\` does not exist — the rule is attributed to a file that is not there`);
        continue;
      }
      const source = readFile(file);
      if ((rule.evidence ?? []).some((needle) => source.includes(needle))) implemented += 1;
      else {
        fail(where, `\`${file}\` no longer contains any of the evidence (${(rule.evidence ?? []).join(', ')}) — either the rule moved or the contract has drifted`);
      }
    }
    if (implemented) clientRuleCount += 1;
    ruleRows.push({ id: rule.id, signal: rule.signal, weight: rule.weight, veto: rule.veto, by: rule.implementedBy.length, implemented });
  }
  if (ruleRows.length && clientRuleCount === 0) {
    fail('x-dizi-duplicate-rules.rules', 'no rule names a file that implements it — the rule set is documentation, not the rule set the product runs');
  }

  /* The roles. P0-205's acceptance is nine legacy roles mapped, MFA forced, and the role claims visible in the
   * token (P0-205). What makes that checkable is that the realm is a file in this repository: the check reads it
   * and holds it against the table, so "the realm has been updated too" is a fact rather than a hope. */
  const roles = doc['x-dizi-roles'] ?? {};
  const roleRows = [];

  for (const key of ['description', 'issuedBy', 'claim', 'abilityMeaning', 'shellNote', 'legacyNote']) {
    if (!roles[key]) fail(`x-dizi-roles.${key}`, `missing \`${key}\``);
  }
  if (JSON.stringify(roles.abilities ?? []) !== JSON.stringify(ABILITIES)) {
    fail('x-dizi-roles.abilities', `must be exactly ${JSON.stringify(ABILITIES)} — the API's ability check and the client read this list`);
  }
  if (JSON.stringify(roles.shells ?? []) !== JSON.stringify(SHELLS)) {
    fail('x-dizi-roles.shells', `must name the app's own shells, ${JSON.stringify(SHELLS)}`);
  }

  const abilitySet = new Set(roles.abilities ?? []);
  const shellSet = new Set(roles.shells ?? []);
  const readOnly = [];
  const roleIds = new Set();
  const legacy = roles.legacy ?? [];
  if (legacy.length !== LEGACY_ROLE_COUNT) {
    fail('x-dizi-roles.legacy', `has ${legacy.length} roles — P0-205 maps exactly ${LEGACY_ROLE_COUNT} legacy roles`);
  }
  for (const [kind, list] of [['legacy', legacy], ['service', roles.service ?? []]]) {
    for (const role of list) {
      const where = `x-dizi-roles.${kind}.${role.id ?? '(no id)'}`;
      if (!role.id || !/^[a-z]+(-[a-z]+)*$/.test(role.id)) fail(where, 'ids are lower-case words joined by hyphens');
      else if (roleIds.has(role.id)) fail(where, 'duplicate role id');
      else roleIds.add(role.id);
      if (!role.label?.en) fail(where, 'missing `label.en` — a role a person cannot read is a role nobody checks');
      if (!role.label?.bn) fail(where, 'missing `label.bn` — the desk is Bangla-first and the role appears in Bangla on the staff list');
      if (!shellSet.has(role.shell)) fail(where, `\`shell: ${role.shell}\` is not one of the app's shells (${SHELLS.join(', ')})`);
      if (!Array.isArray(role.abilities) || !role.abilities.length) fail(where, 'needs `abilities`');
      else {
        for (const ability of role.abilities) if (!abilitySet.has(ability)) fail(where, `\`${ability}\` is outside the ability vocabulary`);
        if (!role.abilities.includes('read')) fail(where, 'every role that can sign in can read something — a role with no `read` cannot use a single screen');
        if (!role.abilities.includes('write') && !role.abilities.includes('administer')) readOnly.push(role.id);
      }
      if (role.mfa !== 'required') fail(where, '`mfa` must be `required` — ADR 0003 makes it mandatory for every role that can reach a clinical or financial record');
      if (!role.because || role.because.length < 80) fail(where, '`because` must explain the mapping in at least 80 characters — it is the sentence a reviewer argues with');
      if (kind === 'legacy') {
        if (!Number.isInteger(role.legacyScreens) || role.legacyScreens <= 0) fail(where, '`legacyScreens` must be the measured count from docs/FEATURE-CATALOG.md §5');
        if (role.legacyScreens > 76) fail(where, 'the legacy Super Admin reaches 76 screens; no role reaches more');
      }
      roleRows.push({ id: role.id, kind, shell: role.shell, abilities: role.abilities ?? [], screens: role.legacyScreens ?? null });
    }
  }
  /* A read-only role has to exist: the API refuses a write to a role that may not write, and if every role may
   * write then that refusal is untestable and, in practice, untested. */
  if (!readOnly.length) {
    fail('x-dizi-roles.service', 'no read-only role — an inspection account that cannot change anything is how a whole class of accident is designed out');
  }

  for (const entry of roles.implementedBy ?? []) {
    const where = `x-dizi-roles.implementedBy.${entry.file ?? '(no file)'}`;
    if (!entry.file) {
      fail('x-dizi-roles.implementedBy', 'an entry names no file');
      continue;
    }
    if (!fileExists(entry.file)) {
      fail(where, 'does not exist — the role table is attributed to a file that is not there');
      continue;
    }
    const source = readFile(entry.file);
    for (const needle of entry.evidence ?? []) {
      if (!source.includes(needle)) fail(where, `no longer contains \`${needle}\` — the role table has drifted from the code that implements it`);
    }
    if (!entry.what || entry.what.length < 40) fail(where, '`what` must say what this file is responsible for');
  }

  const realm = readRealm(roles, fileExists, readFile, fail);
  for (const role of realm.roles ?? []) {
    if (!roleIds.has(role)) fail(REALM_PATH, `declares the role \`${role}\`, which x-dizi-roles.legacy does not — a token for it would be refused`);
  }
  for (const role of legacy) {
    if (!(realm.roles ?? []).includes(role.id)) fail(REALM_PATH, `does not declare \`${role.id}\` — that person cannot sign in`);
  }

  return { roles, roleRows, realm, legacyRoleCount: legacy.length, readOnly, errors, warnings, operations, policyTable, client, entities, drainOutcomes, problemTypes, duplicateRules, ruleRows, thresholds, caps };
}

/* ------------------------------------------------------------------ report */

const VERBS = { get: 'GET ', post: 'POST', patch: 'PATCH', put: 'PUT', delete: 'DEL ' };
const pad = (value, width) => String(value).padEnd(width);

function report({ errors, warnings, operations, policyTable, client, drainOutcomes, problemTypes, ruleRows, thresholds, roles, roleRows, realm, readOnly, caps }, doc, contractLabel, syncLabel) {
  const widths = {
    verb: 5,
    path: Math.max(6, ...operations.map((o) => o.path.length)),
    entity: Math.max(6, ...operations.map((o) => String(o.meta.entity ?? '—').length)),
    offline: Math.max(7, ...operations.map((o) => String(o.meta.offline ?? '—').length)),
    authority: Math.max(9, ...operations.map((o) => String(o.meta.authority ?? '—').length)),
  };

  console.log('\nDiziHospital · contract conformance (P0-207)\n');
  console.log(`contract   ${contractLabel}`);
  console.log(`           openapi ${doc.openapi} · version ${doc.info?.version} · ${Object.keys(doc.paths ?? {}).length} paths · ` +
    `${operations.length} operations · ${Object.keys(doc.components?.schemas ?? {}).length} schemas`);
  console.log(`client     ${syncLabel}`);
  console.log(`           ${client.entities?.length ?? '?'} entities · ${client.drainOutcomes?.length ?? '?'} drain outcomes · ` +
    `${client.policies?.length ?? '?'} conflict policies`);
  if (caps) {
    console.log(`generated  packages/contracts/dist — ${Object.keys(caps.operations ?? {}).length} operations · ` +
      `${Object.keys(caps.entities ?? {}).length} entity policies · ${Object.keys(caps.problemTypes ?? {}).length} problem types`);
  }

  console.log('\noperations');
  for (const { method, path, meta } of operations) {
    const notes = [meta.idempotency === 'required' ? 'idempotent' : null, meta.audit ? 'audit' : null].filter(Boolean).join(' · ');
    console.log(`  ${pad(VERBS[method], widths.verb)} ${pad(path, widths.path)}  ${pad(meta.entity ?? '—', widths.entity)} ` +
      `${pad(meta.offline, widths.offline)} ${pad(meta.authority, widths.authority)} ${notes}`);
  }

  console.log('\nconflict policy agreement');
  for (const row of policyTable) {
    const mark = row.state === 'agreed' ? '✓' : row.state === 'disagreed' ? '✗' : '~';
    console.log(`  ${mark} ${pad(row.entity, 22)} contract ${pad(row.contract, 12)} client ${pad(row.client, 12)}` +
      (row.state === 'ahead' ? '  (the client has not caught up — a warning, not a failure)' : ''));
  }

  if (ruleRows?.length) {
    console.log(`\nduplicate rules  warn ${thresholds.warn} · block ${thresholds.block} · ${ruleRows.length} rules`);

  if (roleRows?.length) {
    const legacyRows = roleRows.filter((r) => r.kind === 'legacy');
    console.log(`\nroles            ${legacyRows.length} legacy · ${roleRows.length - legacyRows.length} service · mfa forced · ${readOnly?.length ?? 0} read-only`);
    for (const row of legacyRows) {
      console.log(`  ${pad(row.id, 14)} ${pad(row.shell, 13)} ${pad(row.abilities.join('+'), 22)} ${row.screens} legacy screens`);
    }
    for (const row of roleRows.filter((r) => r.kind === 'service')) {
      console.log(`  ${pad(row.id, 14)} ${pad(row.shell, 13)} ${pad(row.abilities.join('+'), 22)} not a legacy role`);
    }
    if (realm?.roles?.length) {
      console.log(`realm            ${realm.path} · ${realm.roles.length} roles · ${(realm.clients ?? []).join(', ')}`);
      console.log(`sign-in theme    ${realm.theme} · locales ${(realm.locales ?? []).join(', ')}`);
    }
  }
    for (const row of ruleRows) {
      const mark = row.implemented ? '✓' : '~';
      const where = row.by ? `${row.implemented}/${row.by} file${row.by === 1 ? '' : 's'}` : 'the API computes it; no screen does yet';
      console.log(`  ${mark} ${pad(row.id, 26)} ${pad(row.signal, 12)} ${pad(String(row.weight), 5)} ${row.veto ? 'veto' : '    '}  ${where}`);
    }
  }

  console.log(`\nproblem types   ${Object.keys(problemTypes).length} declared · ${REQUIRED_CODES.length} required and present`);
  console.log(`drain outcomes  ${Object.keys(drainOutcomes).length} declared · the client's union is ${(client.drainOutcomes ?? []).join(' | ')}`);

  if (warnings.length) {
    console.log(`\nwarnings (${warnings.length})`);
    for (const { where, message } of warnings) console.log(`  ~ ${where}\n      ${message}`);
  }
  if (errors.length) {
    console.log(`\nFAILED — ${errors.length} problem${errors.length === 1 ? '' : 's'}\n`);
    for (const { where, message } of errors) console.log(`  ✗ ${where}\n      ${message}`);
    console.log('');
    return 1;
  }
  const agreed = policyTable.filter((r) => r.state === 'agreed').length;
  console.log(`\nOK — ${operations.length} operations conform; ${agreed} entities agree with the client` +
    `${warnings.length ? `; ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}.\n`);
  return 0;
}

/* ------------------------------------------------------------------ self-test */

/**
 * Each case mutates a deep copy and names the message the check has to produce. If a mutation survives, the
 * guardrail has a hole in it and this exits non-zero — which is the only way to trust a green run.
 */
const SELF_TEST_CASES = [
  { name: 'a policy the client does not implement', mutate: (d) => { d['x-dizi-entities']['mar.dose'].policy = 'last-write-wins'; }, expect: 'is not one the client implements' },
  { name: 'a policy that disagrees with the client', mutate: (d) => { d['x-dizi-entities']['observation'].policy = 'field-level'; }, expect: 'policy disagrees with the client' },
  { name: 'a PATCH on an append-only entity', mutate: (d) => { d.paths['/observations'].patch = JSON.parse(JSON.stringify(d.paths['/observations'].post)); }, expect: 'is append-only' },
  { name: 'a queued write with no idempotency key', mutate: (d) => { d.paths['/patients'].post['x-dizi'].idempotency = 'none'; }, expect: 'a queued write must be idempotent' },
  { name: 'a queued read', mutate: (d) => { d.paths['/patients'].get['x-dizi'].offline = 'queue'; }, expect: 'only a mutating operation may be queued' },
  { name: 'a cached write', mutate: (d) => { d.paths['/patients'].post['x-dizi'].offline = 'cache'; }, expect: 'only a read may be served from the replica' },
  { name: 'an online-only operation with no reason', mutate: (d) => { delete d.paths['/health'].get['x-dizi'].notes; }, expect: 'must say why in `x-dizi.notes`' },
  { name: 'a missing Idempotency-Key header', mutate: (d) => { d.paths['/patients'].post.parameters = []; }, expect: 'must declare the `Idempotency-Key` header' },
  { name: 'an undeclared path parameter', mutate: (d) => { d.paths['/patients/{mrn}'].patch.parameters = []; }, expect: 'path parameter `{mrn}` is not declared' },
  { name: 'a $ref that lands nowhere', mutate: (d) => { d.paths['/patients'].get.responses['200'].content['application/json'].schema.$ref = '#/components/schemas/Nope'; }, expect: 'does not resolve' },
  { name: 'a JSON error response', mutate: (d) => { delete d.paths['/patients'].post.responses['422'].content['application/problem+json']; }, expect: 'must be application/problem+json' },
  { name: 'a page-long `because` shortened to a note', mutate: (d) => { d.paths['/invoices'].post['x-dizi'].because = 'Because.'; }, expect: 'at least 80 characters' },
  { name: 'a dropped conflict code', mutate: (d) => { delete d['x-dizi-problem-types']['dizi.dose-already-signed']; }, expect: 'a built screen depends on this failure' },
  { name: 'a dropped drain outcome', mutate: (d) => { delete d['x-dizi-drain-outcomes'].refused; }, expect: 'the client names this outcome' },
  {
    name: 'a client entity the contract does not declare',
    mutate: (d, s) => s
      .replace("  | 'audit';", "  | 'audit'\n  | 'lab.order';")
      .replace('  audit: {', "  'lab.order': {\n    policy: 'exclusive',\n    label: 'Lab order',\n    why: 'A lab order is placed once and then it is a specimen on a bench. Two nodes placing the same order is a second tube of blood from the same arm, so the second is refused rather than merged.',\n  },\n  audit: {"),
    expect: 'the contract declares no policy for it',
  },
  { name: 'a client entity with no policy', mutate: (d, s) => s.replace("  'bed.state': {", "  'bed.state.typo': {"), expect: 'names this entity but declares no policy' },
  { name: 'a client policy changed under the contract', mutate: (d, s) => s.replace("policy: 'exclusive',\n    label: 'Bed state'", "policy: 'field-level',\n    label: 'Bed state'"), expect: 'policy disagrees with the client' },
  { name: 'a dropped convention', mutate: (d) => { delete d['x-dizi-conventions'].audit; }, expect: 'missing `audit`' },
  { name: 'a hole in the queue’s state machine', mutate: (d) => { delete d['x-dizi-scheduling'].queueMoves.Waiting; }, expect: 'a hole in the table' },
  { name: 'a finished visit that can be moved out of', mutate: (d) => { d['x-dizi-scheduling'].queueMoves.Completed.push('Waiting'); }, expect: 'may move anywhere' },
  { name: 'a cancelled patient who can be checked in', mutate: (d) => { d['x-dizi-scheduling'].checkInFrom.push('Cancelled'); }, expect: 'cannot be checked in' },
  { name: 'duplicate thresholds that overlap', mutate: (d) => { d['x-dizi-duplicate-rules'].thresholds.warn = 0.9; }, expect: '`warn` must be below `block`' },
  { name: 'a rule attributed to a file that is not there', mutate: (d) => { d['x-dizi-duplicate-rules'].rules[0].implementedBy = ['apps/web/lib/gone.ts']; }, expect: 'does not exist' },
  { name: 'a rule whose evidence has left the code', mutate: (d) => { d['x-dizi-duplicate-rules'].rules[0].evidence = ['this string is not in any file']; }, expect: 'no longer contains any of the evidence' },
  { name: 'a vetoing rule that scores above the block threshold', mutate: (d) => { d['x-dizi-duplicate-rules'].rules[6].weight = 0.9; }, expect: 'may not score at or above `block`' },
  { name: 'a signal outside the vocabulary', mutate: (d) => { d['x-dizi-duplicate-rules'].rules[3].signal = 'vibes'; }, expect: 'is not one of' },
  { name: 'an audit ledger that is not hash-chained', mutate: (d) => { d.components.schemas.AuditEntry.required = ['id', 'at', 'actor', 'action', 'entity']; }, expect: 'hash-chained' },

  /* The generated projection. These are the mutations that would otherwise reach a desk as a screen quietly
   * disagreeing with the API about whether an action may be queued. */
  { name: 'an operation missing from the generated projection', mutateCaps: (c) => { delete c.operations.createPatient; }, expect: 'is missing from the generated projection' },
  { name: 'an operation added to the projection by hand', mutateCaps: (c) => { c.operations.inventedEndpoint = { ...c.operations.createPatient, id: 'inventedEndpoint' }; }, expect: 'is in the generated projection and not in the contract' },
  { name: 'a paraphrased `because`', mutateCaps: (c) => { c.operations.createPatient.because = 'Duplicate possible.'; }, expect: 'verbatim' },
  { name: 'a derived flag that contradicts `offline`', mutateCaps: (c) => { c.operations.createPatient.mayQueue = false; }, expect: 'implies true' },
  { name: 'a hand-edited entity policy', mutateCaps: (c) => { c.entities['mar.dose'].policy = 'field-level'; }, expect: 'copied verbatim' },
  // Both sides are mutated together so the verbatim check stays quiet and the totality rule is what fires:
  // `drainOutcomeFor` is total, so the contract has to account for every status class.
  { name: 'a drain mapping with no outcome for 5xx', mutate: (d) => { d['x-dizi-drain-outcomes'].deferred.status = 'much later'; }, mutateCaps: (c) => { c.drainOutcomes.deferred.status = 'much later'; }, expect: 'no outcome covers 5xx' },
  { name: 'an idempotency header under a different name', mutateCaps: (c) => { c.idempotencyHeader.name = 'X-Idempotency-Key'; }, expect: 'the contract declares' },
  { name: 'an entity index that has drifted', mutateCaps: (c) => { c.byEntity['bed.state'] = []; }, expect: 'the operations on bed.state are' },
  { name: 'a queueable list that has drifted', mutateCaps: (c) => { c.queueable = []; }, expect: 'and the contract implies' },
];

function selfTest(baseDoc, baseSync, baseCaps) {
  console.log('\ncontract conformance · self-test\n');
  let survived = 0;
  for (const testCase of SELF_TEST_CASES) {
    const doc = JSON.parse(JSON.stringify(baseDoc));
    const caps = JSON.parse(JSON.stringify(baseCaps));
    let sync = baseSync;
    try {
      const mutated = testCase.mutate?.(doc, baseSync);
      if (typeof mutated === 'string') sync = mutated;
      testCase.mutateCaps?.(caps);
    } catch (error) {
      console.log(`  ✗ ${testCase.name}\n      the mutation itself threw: ${error.message}`);
      survived += 1;
      continue;
    }
    const { errors } = validate(doc, sync, { caps });
    const caught = errors.some((e) => e.message.includes(testCase.expect));
    if (caught) {
      console.log(`  ✓ ${testCase.name}`);
    } else {
      console.log(`  ✗ ${testCase.name}\n      expected a failure mentioning “${testCase.expect}”, got ${errors.length} other error${errors.length === 1 ? '' : 's'}`);
      survived += 1;
    }
  }
  const clean = validate(baseDoc, baseSync, { caps: baseCaps });
  if (clean.errors.length) {
    console.log(`  ✗ the unmutated contract is already failing (${clean.errors.length} error${clean.errors.length === 1 ? '' : 's'})`);
    survived += 1;
  } else {
    console.log('  ✓ the unmutated contract passes');
  }
  if (survived) {
    console.log(`\nSELF-TEST FAILED — ${survived} case${survived === 1 ? '' : 's'} not caught by the guardrail\n`);
    return 1;
  }
  console.log(`\nOK — ${SELF_TEST_CASES.length} mutations, all caught.\n`);
  return 0;
}

/* ------------------------------------------------------------------ main */

let doc;
try {
  doc = JSON.parse(readFileSync(contractPath, 'utf8'));
} catch (error) {
  console.error(`\ncontract conformance — cannot read ${contractPath}\n  ${error.message}\n`);
  process.exit(1);
}
const syncSource = readFileSync(syncPath, 'utf8');

const rel = (p) => p.replace(`${root}/`, '');

const capsPathAbs = resolve(root, 'packages/contracts/dist/capabilities.json');

if (args.includes('--self-test')) {
  process.exit(selfTest(doc, syncSource, JSON.parse(readFileSync(capsPathAbs, 'utf8'))));
}

const result = validate(doc, syncSource);
process.exit(report(result, doc, rel(contractPath), rel(syncPath)));
