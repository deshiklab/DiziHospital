# @dizi/web — DiziHospital application shell

Phase 0 slice of the new UI: the shell and the first screens, running against synthetic data.

```bash
npm install          # from the repository root
npm run dev --workspace @dizi/web     # http://localhost:3000  (binds 0.0.0.0)
```

## What is here

| Route | What it demonstrates |
|---|---|
| `/` | Role home with KPI tiles. Every number carries a definition tooltip and an "as of" timestamp — the legacy dashboards show two different occupancy figures with no way to tell which is right |
| `/patients` | DataGrid: server-shaped paging/sort/filter, saved views, column chooser, CSV export, bulk selection, condensing columns for 1280 px counters |
| `/patients/new` | Patient registration: the legacy 19-field modal rebuilt as five titled sections, live duplicate detection on the identity block, scanner-ready fields, and honest offline behaviour ("Saved on this device" vs "Saved") |
| `/<module>` | The **launcher**: modules that are still legacy-owned say so and point at the legacy system, read from the same ownership registry the team maintains (`docs/migration/ownership.md`) |

Global affordances: ⌘K command palette, `/` to focus search, notification centre, help drawer, role switcher,
density switch (comfortable/compact, straight from the tokens), Bangla/English toggle, and a **sync simulator**
so every connectivity state in plan `02` §11 can be reviewed without a network fault.

## What is deliberately not here yet

* No API calls: `lib/mock.ts` is deterministic synthetic data (2 000 patients) that will be deleted in `P0-301`.
  The grid already talks to a query callback, so the swap is a data-source change.
* No auth: Keycloak/OIDC arrives with `P0-205`.
* No real i18n framework: shell strings only; clinical terminology needs the reviewed glossary (`02` §9).
* Grid internals are hand-written for v0; TanStack Table/virtualisation land with `P0-204` completion.

## Conventions

* Styling is Tailwind + tokens from `@dizi/tokens` — no hard-coded colours, spacing or radii in components.
* Primitives come from `@dizi/ui`; a screen that needs a new pattern adds it there, not locally.
* Anything that touches data state must show its sync state (plan `02` §11 rule 1).
