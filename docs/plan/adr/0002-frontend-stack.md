# ADR 0002 — Frontend stack

* Status: **Accepted** — decision **D3 = approved** (2026-10-14)
* Date: 2026-10-14
* Deciders: tech lead, designer, product owner

## Context
We are rebuilding a data-dense, keyboard-heavy, form-heavy hospital UI with 597 grids (up to 17 columns),
9,568 field instances, print requirements (A4/A5/thermal), tablets on wards with intermittent Wi-Fi, and
bilingual (Bangla/English) content. Team size is small; hiring in Dhaka favours React/Node.

## Options
| Stack | Pros | Cons |
|---|---|---|
| **Next.js + TypeScript + Tailwind + Radix/shadcn + TanStack (Query/Table/Virtual) + RHF + Zod** | Largest ecosystem for data grids and forms; server components reduce over-fetch; PWA/offline mature; TanStack Table handles the complex grids; shadcn gives accessible primitives we own | Two languages in the stack (TS + PHP); React churn requires discipline |
| Vue 3 + Nuxt + PrimeVue/Vuetify | Excellent enterprise component suites; smaller learning curve for some teams | Smaller data-grid ecosystem for very wide grids; fewer accessible primitives than Radix |
| Angular | Enterprise conventions, DI, forms | Heaviest learning curve; larger bundles; slower iteration with a small team |
| HTMX/Alpine on server-rendered views | Closest to the current architecture; smallest step | Cannot deliver the offline/PWA, rich-grid or instant-feel goals; would recreate legacy constraints |

## Decision
Next.js (App Router) + TypeScript + Tailwind + Radix/shadcn primitives, TanStack Query/Table/Virtual for data,
React Hook Form + Zod for forms, next-intl for i18n, Storybook + Chromatic for the component contract, Playwright
for E2E. PWA with an offline write queue for ward workflows.

## Decision confirmed
D3 approved on 2026-10-14. Implementation notes added: the offline write queue and its
conflict classes are generated from the API's offline metadata (`01` §5.5), and every screen must be designed
for three states — fresh, LAN-authoritative and offline-queued (`02` §11).

## Consequences
* The design system (`packages/ui`) ships as a versioned package so both the new app and any future portal consume it.
* Tailwind plus tokens keeps styling consistent; arbitrary values are banned in review.
* Server components are used for read-heavy pages; interactive grids remain client components with server-side data.
* We accept maintaining TypeScript tooling alongside PHP during the transition.
