# `@dizi/contracts` — the platform API contract

`openapi.json` is the single source of truth for what the platform API accepts, what it may be asked while the
uplink is down, and how two branches that disagree are reconciled. It is published as a package because P0-207's
acceptance is that it lives here and that a generated TypeScript client builds from it; it exists **before** the
API service does on purpose, because the web app already behaves as if it existed — `apps/web/lib/sync.ts` has been
enforcing the conflict policies since P0-201. Writing it down turns a set of agreements that lived in one file's
comments into something an API service can be built from and a build can check.

It has three consumers, and they are the reason it is checked rather than merely written:

| Consumer | Reads |
|---|---|
| The web app | the per-operation metadata, to decide what may be queued offline and what must be refused with an explanation |
| The API service (P0-301) | the whole document: shapes, statuses, headers, and the failure vocabulary |
| The guardrail (`check.mjs`, this package) | both, and fails the build when they drift apart |

## The metadata is the point

Every operation carries an `x-dizi` block. It is not documentation — it is the input the client is generated from,
so an incomplete one is a broken build rather than a cosmetic gap.

| Field | Values | What it decides |
|---|---|---|
| `entity` | one of `x-dizi-entities` | which conflict policy applies to the record |
| `offline` | `cache` · `queue` · `online-only` | whether the app may serve the read from the replica, queue the write and replay it, or must refuse the action |
| `authority` | `edge` · `cloud` | the tier that owns the record, and therefore whose value wins |
| `idempotency` | `none` · `required` | whether the request must carry an `Idempotency-Key` (`nodeId:seq` for a queued write) |
| `audit` | `true` · `false` | whether the write appends an audit entry in the same transaction |
| `because` | a sentence ≥ 80 characters | what staff are shown when the app refuses the action — the reason in their words, not an error code |
| `notes` | text | required on every `online-only` operation: why it cannot be queued |

Rules the guardrail enforces on that metadata:

* a `queue` write must be idempotent, because a drain that runs twice writes twice;
* only a read may be `cache`, only a mutation may be `queue`;
* an `online-only` operation must say why, since it is the one behaviour staff cannot work around;
* every write documents `401` and `403`, because the contract is where the role rules live;
* every failure is `application/problem+json` — an offline desk showing `500 Internal Server Error` is a support call;
* an `append-only` entity is never corrected in place: it is reversed by appending.

## What else is declared at the root

* **`x-dizi-entities`** — the eleven conflict policies: `field-level` (different fields merge, the same field goes
  to a person), `exclusive` (a bed, a dose, an appointment slot: the second claim is refused), `append-only`
  (events, notes, invoices, payments, audit). Each carries the sentence shown to staff. This mirrors
  `ENTITY_POLICY` in `apps/web/lib/sync.ts`, and the guardrail fails when the two disagree.
* **`x-dizi-drain-outcomes`** — the five ways a replayed write comes back (`applied`, `duplicate`, `conflict`,
  `refused`, `deferred`) and the status that produces each. The client's `DrainOutcome` union and this block must
  name the same five words.
* **`x-dizi-problem-types`** — the failure vocabulary, `dizi.*`. Six are required by name because a built screen
  depends on distinguishing them (`dizi.duplicate-patient`, `dizi.duplicate-operation`, `dizi.slot-taken`,
  `dizi.bed-occupied`, `dizi.dose-already-signed`, `dizi.stale-version`).
* **`x-dizi-duplicate-rules`** — the duplicate rule set, which is P0-301's "documented and tunable": seven rules
  with weights, two thresholds (`warn` 0.4, `block` 0.85), the combination rule, and where a branch tunes them.
  Each rule names the files that implement it, and the guardrail checks they still contain the evidence — a rule
  nobody implements is a claim, not a rule.
* **The audit ledger** (P0-208) — `AuditEntry` carries `hash` and `prevHash` because the ledger is hash-chained: an
  edit in the middle of it has to be *detectable*, not merely discouraged. The chains are per node, since a node
  keeps appending while it is disconnected, and they are reconciled when it drains. The guardrail refuses an audit
  entry schema that is not chained, and refuses a write marked `audit: true` when the entry has nowhere to record it.

## The duplicate rule set, as it stands

`score = min(1, sum of the weights of the matching rules)`; a `veto` rule never contributes to a block.

| Rule | Signal | Weight | In the product today |
|---|---|---|---|
| `identity.mrn-exact` | mrn | 1.00 | import path — an MRN clash is a refusal, not a merge |
| `identity.phone-normalised` | phone | 0.80 | import path and the register screen |
| `identity.national-id-suffix` | nationalId | 0.70 | register screen |
| `identity.name-age-sex` | name | 0.60 | import path |
| `identity.dob-exact` | dob | 0.50 | not yet — the API computes it |
| `identity.name-fuzzy` | name | 0.45 | not yet — the API computes it |
| `identity.sex-conflict` | sex | 0 veto | not yet — the API computes it |

Two things this table already tells us, and neither is a surprise to the code:

1. **The register screen and the import path do not check the same rules.** The register screen checks phone and a
   national-ID suffix; the import path checks normalised phone and name + age + sex. Consolidating both onto this
   rule set is the P0-301 follow-on, and it is the difference between a duplicate check the desk trusts and one it
   learns to click past.
2. **Weight 0.8 sits below `block` on purpose.** A phone number shared by a household must warn, never refuse —
   that threshold is a branch-level judgement, which is why it is data here and not a constant in a component.

## Running the guardrail

```bash
npm run contract:check   # shape + agreement with apps/web/lib/sync.ts
npm run contract:test    # mutates the contract 24 ways and asserts every one is caught
```

The package owns its own check, the way `@dizi/tokens` does, and it has no dependencies — so it runs in the
no-install `verify` job as well as anywhere else:

```bash
npm run check --workspace @dizi/contracts
npm run self-test --workspace @dizi/contracts
node packages/contracts/check.mjs --contract packages/contracts/openapi.json --sync apps/web/lib/sync.ts
```

A guardrail that cannot fail is not a guardrail, so the guardrail is itself tested: `contract:test` breaks the
contract deliberately — a policy the client cannot honour, a queued write with no replay key, a cached write, a
`$ref` that lands nowhere, an audit ledger that is not hash-chained, a duplicate rule attributed to a file that is
gone, a vetoing rule scoring above the block threshold — and fails if any mutation slips through.

## Changing the contract

1. Change `packages/contracts/openapi.json`. It is hand-maintained and hand-readable: keep it pretty, keep the
   `x-dizi` block on every operation, and bump `info.version` for anything that would break a client.
2. Run `npm run contract:check`. If it complains that the client disagrees, the client is usually right — the
   policies in `lib/sync.ts` are the ones the desks have been running against since P0-201. Change the contract, or
   change the client and say why in the entity's `why`.
3. Implement it. The API service owes every path in `paths`; a path with no route is an unfinished ticket, not a
   `501`.
4. Add a self-test case for any new rule the guardrail learns. A new check with no mutation proving it fires is a
   check nobody will trust in six months.

## Where this is going

`services/api` — the Laravel 13 / PHP 8.4 service (D2) — is the next thing that reads this file, and the generated
TypeScript client replaces the hand-written shapes in `apps/web` one endpoint at a time, starting with registration
(P0-301) and appointments (P0-401). Both of those are also where the metadata stops being a description and starts
being the thing that decides: P0-306's offline queue is meant to be driven by `offline` and `authority` per
operation, not by a second list of rules kept in a component.

## Deliberately not here yet

Authentication flows (Keycloak, P0-205), the report and query endpoints that back `/reports`, the document and print
endpoints, notifications (P0-403) and the patient portal. None of them are missing by accident: a screen has to be
writing through an endpoint before it earns a place in the contract, and the ones above have no such screen yet.
When they arrive, they arrive here first.
