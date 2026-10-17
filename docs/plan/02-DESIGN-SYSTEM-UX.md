# 02 — Modern UI/UX: Design System & Experience Plan

Goal: a UI that is **faster for the same tasks than the current one**, legible under hospital lighting, safe
for clinical use, accessible, bilingual (Bangla/English) and printable. "Modern" here means *task speed,
clarity and safety* — not decoration.

## 1. Ten UX principles (each with a rule we can test)

| # | Principle | Concrete rule | Test |
|---|---|---|---|
| 1 | **Patient context is always present** | Sticky patient banner on every clinical screen: name, MRN, age/sex, ward/bed, allergies, alerts, paying status | Screenshot review; no clinical screen without it |
| 2 | **Scan, don't type** | Every place an ID exists (patient, case, sample, batch, invoice) accepts barcode/QR and falls back to typing | Scanner used in pilot > 60 % of lookups |
| 3 | **One task, one screen** | A task never requires leaving the page; long forms use a full-screen sheet or a stepped wizard, not a nested modal | Click count ≤ legacy − 30 % per task |
| 4 | **Server-side truth for lists** | No client-side DataTables; every grid is paged, filtered and sorted server-side with URL-addressable state | 100 k rows load < 1 s |
| 5 | **Defaults from context** | Booking a slot defaults to the logged-in doctor's next free slot; a lab order defaults to the visit's diagnosis | Usability test task time |
| 6 | **Prevent, then confirm, then audit** | Destructive/irreversible actions are previewed (what will change), confirmed with typed intent, and written to the audit ledger | Red-team a delete in review |
| 7 | **Safety surfaces must be loud** | Allergies, drug interactions, critical lab values, duplicate patients, stock expiry shortfalls use the reserved safety colour family + icon + text (never colour alone) | Clinical validation checklist |
| 8 | **Density on demand** | Comfortable (default) and Compact modes; power users get Compact + keyboard shortcuts + command palette | Settings telemetry |
| 9 | **Never lose work** | Autosave drafts for long forms (notes, prescriptions, reports) with "restored draft" affordance | Kill the tab mid-consult test |
| 10 | **Accessible by construction** | Contrast ≥ 4.5:1, focus visible, targets ≥ 44 px on touch, full keyboard path, screen-reader names on every control | axe 0 critical + manual audit each phase |

## 2. Research before pixels (Phase 0/1)

1. **Shadow 6 roles for a full shift** — reception, OPD doctor, nurse, pharmacist, lab tech, billing clerk. Record: tasks, time per task, workarounds, paper artifacts, interruptions.
2. **Task inventory & timing baseline** for ~25 critical tasks (register patient, book appointment, write prescription, dispense, enter result, raise bill, discharge, shift handover). These become the success metrics.
3. **Data-entry audit** of the 389 distinct field names — which are actually used, which are dead (e.g. `refference`), which are mislabelled.
4. **Usability baseline** with 5 staff per role on the legacy app (SUS + task success/time/errors).
5. **Accessibility & hardware audit** — screen reader pass, contrast measurement, scanner/printer/tablet inventory.
6. **Patient research** — 8–10 patients/carers on the portal and website (language preference, literacy, device).

Re-run usability testing every phase with ≥ 5 users and publish results in `docs/research/`.

## 3. Information architecture

Replace the 30-item flat sidebar with **role-aware navigation** and global search:

```
┌ Dashboard (role home)
├ Patients        search · register · profiles · merges · imports
├ Appointments    calendar · queue board · online requests
├ Clinical        OPD consultation · IPD/wards · orders · results
├ Diagnostics     lab worklist · imaging worklist · blood bank
├ Pharmacy        dispense · stock · purchase · returns
├ Billing         charges · invoices · payments · claims (TPA)
├ Inventory       items · issue/return · suppliers
├ Reports         saved reports · builder · exports
├ Admin           users & roles · masters · branches · print templates · settings
└ Help            in-app guides, shortcuts, feedback
```

Rules: maximum two levels; every route is a link (copy/paste a URL and land on the same view);
the same filter state survives navigation; the sidebar is collapsible and the whole app is usable at 1280 px
without horizontal scroll (grids condense columns).

**Global affordances** (replacing "Quick Add" + bell + bed modal):

* **Command palette** (`Ctrl/⌘-K`) — jump to any screen, patient, or action ("new appointment for Ahmed").
* **Universal patient search** — MRN, phone, name, national ID, guardian, with fuzzy matching and recent patients.
* **Global action bar** — the three most relevant actions for the current screen, keyboard-addressable (`Alt+1..3`).
* **Notification centre** — grouped alerts with actions inline (approve appointment, acknowledge critical result).
* **Help drawer** — contextual how-to (from the mirrored vendor help library in `docs/help-library/`) beside the screen.

## 4. Design tokens

Authoritative JSON: [`design-tokens.json`](design-tokens.json) — consumed by Style Dictionary into CSS variables
and Tailwind theme. Summary:

| Group | Definition |
|---|---|
| Brand | deep teal `#0E6E7A` primary, `#0A4F58` pressed, `#E6F4F6` subtle surface — calm, clinical, high-contrast |
| **Safety family** (reserved, never brand) | critical `#B3261E`, warning `#B26B00`, success `#1B7F4B`, info `#1D4ED8`; each with tint/border/text variants |
| Clinical status | neutral, admitted, discharged, in-progress, awaiting-result, cancelled, no-show, critical-value |
| Surfaces | canvas `#F7F9FB`, surface `#FFFFFF`, sunken `#EEF2F6`, border `#D7DEE7`, overlay 40 % |
| Text | primary `#101828`, secondary `#475467`, disabled `#98A2B3`, inverse `#FFFFFF` — all pairs ≥ 4.5:1 |
| Typography | `Inter` (UI) + `Noto Sans Bengali` (bn); scale 12/13/14/16/18/20/24/30/38; tabular numbers for money/clinical values |
| Spacing / radius / elevation | 4 px base scale (4…64); radius 6/10/14; three elevation levels only |
| Density | comfortable 40 px rows / compact 32 px rows |
| Motion | 120/180/240 ms, `ease-out`; all animation honours `prefers-reduced-motion` |
| Themes | light, dark (night shifts), high-contrast; token-driven, no hard-coded colours |

## 5. Component inventory (v1)

Derived from the captured evidence: 597 grids (max 17 columns), 9,568 field instances, 441 tabs, 978 filters,
96 dialogs. Twelve primitives cover ~80 % of the surface.

| # | Component | Replaces / serves | Notes (from evidence) |
|---|---|---|---|
| 1 | **AppShell** | sidebar, header, breadcrumbs | role-aware nav, palette, notification centre, help drawer |
| 2 | **PatientBanner** | the ad-hoc patient headers | allergies, alerts, MRN, age/sex, bed, payer |
| 3 | **DataGrid** | 597 DataTables | server-side paging/sort/filter, saved views, column chooser, sticky first column, inline row actions, bulk select with preview, CSV/XLSX export, virtual scrolling, keyboard navigation, empty/loading/error states |
| 4 | **Form kit** | 9,568 fields | text, textarea, number/currency (locale-aware), date/time, duration, select (searchable, virtualised), multi-select, radio/segmented, checkbox/switch, file+scan upload, signature, barcode input, address block, phone (BD/IN formats), dosage input, autocomplete-from-master |
| 5 | **Detail layout** | 441 tabs | tabs → **anchor sub-nav + deep links**; long records use a 2-column layout with a sticky summary rail |
| 6 | **Money & billing block** | billing screens | charge picker from the charge master, discount rules, tax, partial payments, payment-mode strip, change-due, receipt print |
| 7 | **Order composer** | lab/radiology/pharmacy orders | multi-select from catalogues with groups, profiles/panels, urgency, clinical notes, order sets ("fever panel") |
| 8 | **Result / report viewer** | lab, imaging, document centre | parameter table with ranges, flags, trend sparkline, previous results, approve/release workflow, print/PDF |
| 9 | **Safety banners & alerts** | new | allergy, interaction, duplicate-patient, critical-value, stock-out — colour + icon + text + required acknowledgement |
| 10 | **Clinical timeline** | IPD timeline tab | unified events (visits, orders, meds, notes, bills) with filters and jump-to-source |
| 11 | **Boards** | bed board, queue board, ward census, OT list | drag-free state transitions with confirmation, colour-blind-safe statuses, large-text TV mode for waiting rooms |
| 12 | **Charts & KPIs** | dashboard | KPI tile with definition tooltip and "as of" timestamp, trend/sparkline, donut, bar; every number traceable to a drill-down list (fixes today's inconsistent dashboards) |

Supporting: CommandPalette, NotificationCentre, Drawer/Sheet, Wizard/Stepper, ConfirmDanger (typed intent),
AuditTrail drawer, PrintPreview, EmptyState, Banner, Toast, Tooltip/HelpPopover, Pagination, FilterBar,
SavedViews, SkeletonLoader, GlobalSearch, LanguageSwitcher, DensityToggle.

## 6. Screen patterns (canonical layouts)

1. **List screen** — FilterBar (saved views) → DataGrid → row actions; URL holds filters.
2. **Register/edit** — full-page form in sections, autosave, "save & new", duplicate detection on the identity block.
3. **Consultation workspace** (the heart of OPD) — patient banner + three panes: *history* (visits, allergies, meds, results) · *this encounter* (complaint, findings, diagnosis via ICD-10 search, prescription, orders) · *actions* (bill, print, follow-up). Keyboard-first, no page reloads.
4. **Worklist** — queue of items with status swimlanes (e.g. lab: ordered → collected → in-progress → ready → released), bulk actions, SLA timers.
5. **Wizard for money** — raise invoice: select case → add charges → discounts/tax → payments → print. Each step validated, back-navigation safe, idempotency key on submit.
6. **Report screen** — filters + preview in the same page, "save as view", export, and a definition card ("how this number is calculated").
7. **Board** — big-name status board for beds/queues with TV mode and 5-minute auto-refresh.
8. **Portal** — patient-facing: appointments, prescriptions, results, bills, payments, feedback; mobile-first, Bangla default with English switch.

## 7. Accessibility (WCAG 2.2 AA)

* Semantic HTML first; ARIA only where HTML has no equivalent. Every control has an accessible name (the legacy screens have unlabelled icon buttons — a bug we will not reproduce).
* **Keyboard:** full tab order, visible focus ring, `Esc` closes overlays, arrow-key navigation inside grids/comboboxes, skip-to-content link, shortcut sheet (`?`).
* **Screen reader:** grids announce row/column and sort state; form errors announce with field association; live regions for save/release actions.
* **Colour:** statuses never rely on colour alone; tested with deuteranopia/protanopia simulation; contrast verified in the token build.
* **Touch & motor:** 44 px minimum targets, no drag-only interactions, timeouts are configurable and warned.
* **Cognitive:** plain language (grade 8), consistent terminology, no unexplained abbreviations, help text next to fields (`refference` → "Referral source").
* **Testing:** `axe-core` in CI on every story and page; manual audit per phase with NVDA/VoiceOver; accessibility statement published.

## 8. Content design & terminology cleanup

Fix on rebuild (evidence: capture profiles):

| Current | Change to |
|---|---|
| "Complain" | "Complaint" |
| `refference` field | "Referral source" (`referral_source`) |
| Stray button labelled "2" | remove / give a real label (it is an unlabelled count) |
| Moqtibake `Â·`, raw `&mdash;`, `&amp;` in headers | proper separators, UTF-8 end to end |
| "OPD - Out Patient" | "OPD (Out-patient)" |
| "Is Antenatal" | "Antenatal" |
| Mixed Title Case in menus | sentence case for menu items, Title Case for page titles only |

Also: a hospital glossary in `docs/` (Bangla/English) so labels, printouts and the portal all use one vocabulary;
error messages written as *what happened + what to do*; empty states that explain why a list is empty and offer the
next action.

## 9. Localisation & formats

* `next-intl` with ICU messages; launch locales `en` and `bn-BD`; locale switch persists per user.
* Numbers/currency/date via `Intl` with per-tenant config: **BDT ৳ default** (configurable), `dd MMM yyyy` dates, 12/24 h clock, timezone `Asia/Dhaka`, Bangla numerals optional for patient-facing views.
* Clinical units rendered in both metric and the unit recorded; never silently convert.
* RTL-ready layout (logical CSS properties) even though launch locales are LTR.
* Print templates localised (headings, labels) with hospital logo, address, licence numbers, and Bangla font embedding for PDFs.

## 10. Device, hardware and print strategy

| Context | Design response |
|---|---|
| Front-desk desktop 1366×768 | Default target; grids condense columns; no horizontal scroll for primary tasks |
| Ward tablet (rounds) | Touch-first layouts, large targets, PWA offline queue for vitals/notes, camera for QR/barcode, 4 h offline tolerance |
| Pharmacy counter | Keyboard + scanner wedge-optimised flows, fast search, expiry guard, label printing, "no mouse" path |
| Lab bench | Barcode specimen flow, batch result entry, keyboard-only entry, dark-ish low-glare mode option |
| Waiting room TV | Queue/token board in large-text mode, auto-refresh, Bangla/English toggle |
| Printers | A4 reports/certificates, A5 prescriptions, thermal 80 mm receipts, label printers for specimens; every artifact has a PrintPreview and a print-CSS template; QR on printed items links back to the digital record |

## 11. Offline, degraded-network and sync UX

The platform runs on the hospital LAN and syncs to the cloud (D4), so **every screen exists in more than one
network state**. Designing only the connected state is how offline systems lose nurses' trust.

**Five states, always visible, never guessed** (tokens: `sync.*` in `design-tokens.json`):

| State | What is true | What the UI shows | What is allowed |
|---|---|---|---|
| **Live** | Edge node reachable, sync lag < 60 s | nothing (no badge needed) | everything |
| **LAN only** | Edge node reachable, uplink down | a quiet "Local · offline" pill in the header | everything, including writes; nothing is blocked |
| **Queued** | Device offline, writes held in the PWA queue | per-record chip "Saved on this device · will sync" + a count in the header | reads from cache, writes to the queue, printing |
| **Syncing** | Queue draining after reconnect | progress + "N of M synced", resolved by itself | everything |
| **Conflict / stale** | Another node changed the same field, or cached data is older than the threshold | conflict chip + review inbox; stale data flagged with "as of HH:MM" | reads, and the review action |

**Rules (all testable)**

1. **Never say "saved" when only the device knows.** Two distinct confirmations: "Saved here" (queued) and
   "Saved" (accepted by the edge node). Green ticks mean the server has it.
2. **Never block clinical care on sync.** A conflict on a patient's phone number must not stop a nurse
   documenting vitals; the conflict goes to a review queue with an owner and a deadline (one shift).
3. **Every queued item is inspectable** — a staff-visible list of what has not yet been synced, per device,
   with the ability to retry, and the reason when a write was rejected.
4. **Print works offline** for the documents that matter at the counter: registration slip, prescription,
   receipt, specimen label. Print templates are cached with the app.
5. **Stale data is labelled, not hidden.** Any list older than the freshness threshold shows "as of 14:05"
   and a refresh action; clinical decision screens show the age of the data they are displaying.
6. **Degrade in a defined order**: writes queue → live updates stop (fall back to polling) → cross-node
   features (portal, analytics) hide → print and local search keep working. Users never see a dead spinner.
7. **Site mode is visible to staff** (`edge-authoritative` vs `cloud-direct`), because it changes which system
   is authoritative and what they should do if something looks wrong.
8. **One vocabulary, two languages.** Fixed strings, translated, not improvised: `Local`, `Synced`,
   `Waiting to sync`, `Needs review`, `As of {time}`.

**Test in CI:** every golden journey runs in three modes — connected, LAN-only with the uplink blocked, and
offline-queued with a forced reconnect. A screen that has not been through the offline mode is not done.

## 12. Design operations

* **Figma library mirrors the code library 1:1** (same names, same tokens); tokens flow Figma → `design-tokens.json` → Style Dictionary → CSS/Tailwind, with a CI check that fails on drift.
* **Storybook** is the contract: every component has stories, states (loading/empty/error/dense), a11y tests and visual-regression snapshots (Chromatic).
* **Design review ritual** — weekly 45-minute critique; a screen is "design ready" only when it passes the checklist: patient context, keyboard path, error/empty/loading states, print behaviour, i18n length (+40 % text), a11y, and a task-time estimate.
* **Design debt register** in `docs/plan/` — anything shipped with a compromise gets an entry with a removal trigger.

## 13. Definition of a "modern" screen (checklist)

- [ ] Reachable by URL, palette and sidebar; role-aware
- [ ] Patient banner where clinical context applies
- [ ] Server-side grid with saved views when it lists data
- [ ] Keyboard-complete, including shortcuts for primary actions
- [ ] All four states designed: loading, empty, error, offline
- [ ] Safety surfaces (alerts, destructive confirmations) implemented
- [ ] Bangla + English verified, no truncation at +40 % length
- [ ] Print/PDF output verified on A4/A5/thermal where applicable
- [ ] axe clean, contrast verified, targets ≥ 44 px on touch layouts
- [ ] Task-time measured against the legacy baseline and improved ≥ 30 %
