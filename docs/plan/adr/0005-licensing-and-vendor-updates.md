# ADR 0005 — Licensing, forking and vendor updates

* Status: **Accepted** (legal position to be confirmed by the sponsor)
* Date: 2026-10-14
* Deciders: sponsor, legal, tech lead

## Context
The product is commercially licensed (CodeCanyon, QDOCS Smart Hospital). The vendor ships frequently — v7.0
introduced a new theme system, WhatsApp messaging, survey forms, a SaaS addon, message queue and ICD-10.
Our modernization forks the product and adds substantial new code; if we simply "upgrade" via vendor packages
we will overwrite our work, and if we fork blindly we lose vendor bug fixes and security patches.

## Decision
1. Our fork is **private**; the licence permits modification for one end product but not redistribution.
   If DiziHospital is to be offered to other hospitals or as a hosted service, an extended/SaaS licence must be
   purchased **before** Phase 0 ends.
2. The vendor source lives in `legacy/` with a permanent `vendor/upstream` branch tracking vendor releases.
3. Vendor updates are **merged, never copied**: a monthly sync merge into a `vendor/updates` branch, run through
   the regression suite, then merged into the fork; **security fixes are cherry-picked immediately**.
4. All local modifications to vendor files are recorded in `docs/vendor-modifications.md` (file, reason, date) so
   a future merge can be reasoned about; new features are written in our own packages/modules, not patched into
   vendor files.
5. We track vendor licences and third-party dependencies (SBOM generated in CI) and review them quarterly.

## Consequences
* Merge debt becomes visible and managed rather than discovered during an emergency upgrade.
* Rebasing our own changes onto vendor releases has a recurring cost (estimated ~1 engineer-day per month plus
  the regression run) — accepted deliberately.
* Because the vendor's own roadmap overlaps ours (theme, WhatsApp, surveys), features are re-evaluated at each
  phase gate: adopt the vendor's implementation, or build ours, but never both.
