# ADR 0005 — No fork: clean-room rebuild, vendor relationship and exit policy

* Status: **Accepted** (supersedes the fork/vendor-merge policy — decision **D1 = no vendor source code**)
* Date: 2026-10-14 (revised)
* Deciders: sponsor, legal, tech lead

## Context
The product is commercially licensed (CodeCanyon / vendor distribution). Under decision D1 we **do not hold
the source code**, so the fork-and-merge policy in the original version of this ADR is void: there is nothing
to fork, no vendor branch to track, and no merge debt. What remains, and matters more than before, is:

1. the legacy instance keeps running (and must stay licensed and supported) until the last module is migrated;
2. our new platform must be provably **our own work** — no vendor code, assets, fonts, CSS, SQL or templates
   copied into it;
3. we must be able to **leave the vendor deliberately** — with our data, in readable formats, on our terms.

## Decision

1. **Clean-room rule.** The new platform is written from (a) our own capture of observable behaviour,
   (b) the vendor's publicly published documentation (mirrored for reference in `docs/help-library/`), and
   (c) requirements agreed with the hospital. **Nothing vendor-authored is copied into product code**: no source,
   CSS, images, fonts, icons, SQL or templates under `apps/`, `packages/` or `services/`.
   Reference material is different from product material and is kept apart on purpose: the mirrored help library
   and our capture screenshots live under `docs/` with attribution, are never shipped in the application, and may
   not be copied into it. `tools/ci/clean-room.mjs` enforces exactly that — it scans product directories and
   fails on vendor markers, while documentation directories are excluded by design.
2. **Two-team wall if source is ever obtained.** If the source is purchased later (for example to accelerate
   the bridge), anyone who reads it may not write new-platform code, and vice versa. This protects the
   clean-room position that lets us license or sell our platform later.
3. **Request, don't patch.** Legacy defects and improvements go to the vendor as a ranked, evidenced list
   (screenshots and reproduction steps from the capture). The subscription stays paid and documented. We do not
   modify the vendor instance.
4. **Change control during transition.** No vendor upgrade is installed within ±14 days of a module cutover
   without the tech lead's written approval; upgrades are regression-tested against the bridge contract tests
   before and after.
5. **Data access is contractual.** The data-access addendum (`08` §2) — scope, transport, cadence, checksums,
   change notice, credential custody, retention and exit clause — is signed before Phase 0 exits.
6. **Exit is planned from day one.** Complete machine-readable export (CSV + Parquet), documents with checksums,
   rendered PDFs of printable records, archive instance retention, credentials revoked and licences terminated
   in writing at P9 (`08` §7, `06` §7).
7. **Third-party inventory.** An SBOM is generated in CI; all dependencies (including the vendor's own
   third-party components) are reviewed quarterly with legal.

## Consequences
* We can license, sell or open-source our platform without worrying about derivative-work claims; the cost is
  the discipline of never copying — which is cheap now and expensive later if ignored.
* Vendor defects that hurt safety (bulk delete without confirmation, hard-coded currency, mojibake headers)
  remain until the module is replaced or the vendor fixes them → mitigated by leading the request list with
  the safety-critical items and by replacing those modules early where practical.
* Bridge work is larger than it would have been with a fork (~115 engineer-days; see `04` §6) — accepted as the
  price of not depending on code we do not own.
* Any future vendor upgrade carries a regression risk for rung-3/rung-4 bridge flows (`08` §4) → contract tests
  plus volume caps plus kill switches.
