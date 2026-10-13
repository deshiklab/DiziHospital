# Improvement Backlog — DiziHospital / Smart Hospital

Findings from the full application exploration (76 screens, all forms, all roles, public site) and a prioritised plan for
the next phase. Every item references evidence: the screenshot id is the file name in `docs/assets/screens/`.

**Priority key** — `P0` blocking/risky, `P1` high value, `P2` valuable, `P3` nice to have.
**Size** — `S` ≤ 1 day, `M` 2–5 days, `L` 1–3 weeks, `XL` > 3 weeks.

---

## 1. What the product already does well (protect these)

| Strength | Evidence |
|---|---|
| Complete hospital ERP surface — registration, OPD, IPD, pharmacy, lab, imaging, blood bank, ambulance, HR, finance, reports, CMS, telemedicine | `001` … `076` catalogued screens |
| Genuine clinical depth (vitals, obstetric history, ICD-10, findings libraries, batch prescriptions) | `005-opd-out-patient`, `006-ipd-in-patient` |
| Nine granular staff roles driven by real menu/screen permissions | role dashboards captured in `docs/FEATURE-CATALOG.md` §4 |
| Analytics on the landing page (KPIs, 12-month trend, module income donut, live activity) | `001-dashboard` |
| Legal + statutory coverage (birth/death registers, certificates, ID cards, print header/footer per module) | `013`, `014`, `034`, `035`, `036`, `059` |
| Multi-branch operation with consolidated overview and comparative reporting | `015`, `016`, `017` |
| Modern public website + patient portal served by the same installation | front-site capture |

---

## 2. Findings & backlog

### 2.1 Correctness, trust and data integrity

| # | Finding (evidence) | Why it matters | Fix | Pri | Size |
|---|---|---|---|---|---|
| A1 | Dashboard tile arithmetic is inconsistent: *Bed occupancy 56%* vs *30 / 54*, and the same card says *24 Available · 30 Allotted · 0 Unused* (`001-dashboard`) | Numeric contradictions destroy trust in every other number | Centralise KPI computation in one service; add server-side tests for each KPI; show "as of" timestamp | **P0** | M |
| A2 | Mixed currency presentation — the demo shows `$` on all money columns (`001`, `003`, `025`, `026`) while the product is used mostly in INR markets | Wrong invoices/reports for the payer | Make currency symbol/locale a single setting; format through one helper; add thousand/lakh formatting option | **P0** | S |
| A3 | Outstanding-bills tile shows *171 Unpaid · 67 Overdue* but *Today's appointments 0* with an empty grid (`001`, `004`) — empty-state vs zero-state are conflated | Users cannot tell "no data" from "not loaded" | Distinguish empty states with explicit messaging + "why is this empty" hint | P1 | S |
| A4 | Terminology drift in navigation: "Complain" (should be *Complaint*), "Overview" vs "Overview ", inconsistent Title Case, "Birth & Death Record" group holding a "Birth Record" duplicate (`012`, `015`, nav.json) | Professionalism + searchability | Ship a terminology pass + i18n key review | P1 | S |
| A5 | Duplicated destructive actions: *Delete Selected* on list screens with no confirmation summary of what will be deleted (`002-patient`) | Accidental loss of clinical records | Two-step delete with count preview + soft-delete default + restore view | **P0** | M |

### 2.2 Clinical & operational workflow gaps

| # | Gap | Impact | Proposal | Pri | Size |
|---|---|---|---|---|---|
| B1 | No visible patient queue/token display for waiting rooms; *Queue* exists inside Appointment only (`004`) | Reception crowding, no patient self-visibility | Add a queue/token board screen (TV mode) with live status per doctor/counter | P1 | M |
| B2 | No bed-transfer / bed-board interaction in the captured UI (`058` is a status list) | Nurses phone the desk to move patients | Drag-and-drop bed board with transfer history and housekeeping status (clean/dirty/blocked) | P1 | L |
| B3 | Lab workflow has no barcode/specimen tracking or instrument interface (`008`) | Sample mix-ups, manual transcription | Specimen barcode + analyzer (HL7/ASTM) interface + critical-value alerting with acknowledgement | P1 | XL |
| B4 | Discharge summary / OT notes templates are not visible as structured documents (`006`, `061`, `055`) | Doctors retype; medico-legal risk | Template engine with specialty packs, versioning, e-sign and print/PDF | P1 | L |
| B5 | No consent forms, no patient allergy/interaction checking in pharmacy (`007`) | Patient safety | Allergy/intolerance register + interaction warnings at prescription and dispense time | **P0** | L |
| B6 | No appointment reminders or no-show handling visible (`004`, `029`, `004` online queue) | Revenue leakage (no-shows ~15–25%) | SMS/WhatsApp/e-mail reminder ladder, confirm/decline links, waitlist auto-fill | P1 | M |
| B7 | Blood bank has stock and issue but no cross-match/antibody record screens captured (`010`) | Transfusion safety | Cross-match worksheet, reaction reporting, donor deferral register | P1 | L |
| B8 | No ambulance dispatch tracking (driver app/GPS) — only a call register (`011`) | Emergency response visibility | Live dispatch board + ETA + vehicle status, optional driver mobile link | P2 | L |
| B9 | No structured referral/transfer-out letter between branches or hospitals (`023`, `015`) | Continuity of care | Referral document with clinical summary attached to the case | P2 | M |

### 2.3 Money and billing

| # | Gap | Impact | Proposal | Pri | Size |
|---|---|---|---|---|---|
| C1 | No online payment capture in the admin billing screens captured (`003`) | Patients must pay at the counter | Payment-gateway integration (UPI/card/netbanking) with reconciliation report | P1 | L |
| C2 | Outstanding/overdue bills have no dunning workflow (`001` tile only) | Slow collections | Ageing buckets, statement generation, reminder schedule, write-off approval flow | P1 | M |
| C3 | Insurance/TPA is a register, not a claim pipeline (`024`, `051`) | Claims delayed/rejected | Claim status workflow, document checklist, shortfall tracking, submission log | P1 | L |
| C4 | No GST/e-invoice compliance artefacts visible on bills (`003`, `059`) | Statutory risk in India | GST fields per charge head, HSN/SAC, tax invoice format, e-invoice export | P2 | L |
| C5 | No financial close/period locking or expense approval chain (`025`, `026`) | Books can be edited after closing | Period close + approval workflow + immutable audit of edits | P1 | M |

### 2.4 Experience, design and accessibility

| # | Finding (evidence) | Impact | Fix | Pri | Size |
|---|---|---|---|---|---|
| D1 | 76 screens, many list screens with 8–15 near-identical forms in the DOM (all modals pre-rendered: `002` shows 5 forms, `038`/`039` show 31/34 forms) | Slow pages, fragile DOM, hard to maintain | Lazy-render modals; split screens; introduce a component library with consistent patterns | P1 | L |
| D2 | Global patient search matches name only (`002`, header) | Staff cannot find patients by ID/phone (the most reliable identifiers) | Extend to MR number, phone, guardian name, with fuzzy match and recent results | **P0** | S |
| D3 | Filter/search controls reset when you return from a record (typical DataTables client-side state) | Repetitive work per patient | Persist filters in URL/session; remember last view per user | P1 | M |
| D4 | Accessibility: icon-only controls without accessible names, low-contrast badges/status pills, inconsistent focus outlines, table headers not scoped (observed across all screens) | WCAG failure, poor for low-vision staff | Accessibility pass: names/roles, contrast tokens, focus rings, `scope` on headers, modal focus trap | P1 | M |
| D5 | No keyboard shortcuts or command palette; power users click through menus (`sh-sidenav`) | Slow for heavy users (billing/lab) | Command palette (Ctrl-K) + screen shortcuts + barcode/scan-to-search | P2 | M |
| D6 | No dark mode / high-contrast theme for night shifts (a `--sh-theme-vars` token block exists but no toggle) | Eye strain on night duty | Ship theme toggle wired to the existing token layer, honour `prefers-color-scheme` | P2 | S |
| D7 | Print/PDF output uses per-module headers; no unified preview (`059`) | Surprise formatting on real paper | WYSIWYG print preview + template validation before saving | P2 | M |
| D8 | Mobile: admin screens are desktop-first (fixed 1440 layout, wide tables) | Doctors/nurses work on phones/tablets | Responsive table pattern (card mode), touch targets, PWA shell | P1 | L |

### 2.5 Platform, integration and scale

| # | Gap | Impact | Proposal | Pri | Size |
|---|---|---|---|---|---|
| E1 | No API layer found for the admin app (server-rendered CodeIgniter views + jQuery) | Blocks mobile apps, kiosks, partner integrations | Versioned REST/JSON API with token auth, OpenAPI spec, rate limits | P1 | XL |
| E2 | No webhook/event bus for external systems (`029` is a notice board) | Cannot integrate with HIS/LIS/PACS/ERP | Event outbox (patient.created, bill.paid, report.ready) + webhooks | P2 | L |
| E3 | Legacy stack (PHP/CodeIgniter + jQuery, vendor-maintained) | Hiring and security updates | Decide: harden current stack vs. strangler-pattern re-platform; document decision record | P1 | XL |
| E4 | Security hardening not evidenced: no 2FA/MFA, no password policy UI, no session/IP log, no rate limiting on login (`/site/login`) | Breach and compliance risk | MFA for admins, password policy, login throttling, session register, admin action audit | **P0** | L |
| E5 | Vendor licence validation screen in the super-admin shell (`001` footer modals: *Register your purchase code*, *Register your Addon*) | SaaS/productisation blocker; runtime dependency on vendor licence server | Replace with first-party licensing/feature flags; make it non-blocking for self-hosted builds | P1 | M |
| E6 | No observability: no health endpoint, structured logs, metrics or error tracking observed | Blind during incidents | Health/readiness endpoints, structured audit + app logs, metrics (latency, errors), alerting | P1 | M |
| E7 | Backup/restore not exposed in the UI (vendor docs cover manual DB backup only) | Data-loss risk | One-click encrypted backups, retention policy, restore drill, documented RPO/RTO | **P0** | M |
| E8 | No automated tests / CI in the product | Regressions on every change | Add CI (lint + unit + smoke E2E on the golden-path journeys used for this capture) | P1 | L |
| E9 | Large datasets: lists are DataTables client-side with default page length 10 (`002`, `018`) | Degrades at hospital scale (100k+ patients) | Server-side pagination/search, DB indexes, query budgets, caching for dashboards | P1 | L |
| E10 | India digital-health interoperability (ABDM/ABHA, FHIR) absent | Regulatory direction and payer requirements | ABHA creation/linking, FHIR R4 facade for key resources, consent artefact handling | P2 | XL |

### 2.6 Content, portal and communication

| # | Gap | Impact | Proposal | Pri | Size |
|---|---|---|---|---|---|
| F1 | Patient portal capture shows only login; self-service depth (reports, bills, rebooking) unverified (`patient-portal-login.jpg`) | Adoption of self-service | Confirm/extend: download reports, pay bills, rebook, family accounts, notification preferences | P2 | M |
| F2 | Survey forms are admin-defined; no NPS/feedback trigger after discharge (`027`, `028`) | No voice-of-patient loop | Auto-send feedback survey after discharge/payment with KPI dashboard | P2 | M |
| F3 | Notice board/messaging has no read receipts or escalation (`029`) | Policy notices unverified | Read tracking, acknowledgement-required notices, escalation | P2 | S |
| F4 | Front CMS content is strong but has no SEO/schema analytics surface in the capture (`037`) | Lost patient acquisition | Health-check for SEO meta, structured data for departments/doctors, analytics hookup | P3 | S |
| F5 | No patient-facing cost estimate or package pricing on the site/front desk | Price anxiety and disputes | Package/estimate builder (procedure → expected cost) printable for the patient | P2 | M |

---

## 3. Suggested sequence

**Phase 1 — Trust & safety (2–3 weeks, P0 items)**
A1 KPI correctness · A2 currency/locale · A5 safe delete · B5 allergy & interaction checks · D2 smarter patient search ·
E4 security baseline (MFA, throttle, session register) · E7 backup/restore.

**Phase 2 — Front-desk velocity (3–4 weeks, high-value P1)**
B1 queue board · B6 reminders & no-show recovery · C2 collections ageing + statements · D1 page/modals performance ·
D3 filter persistence · E9 server-side pagination on the biggest lists (patients, bills, lab).

**Phase 3 — Clinical depth (4–6 weeks)**
B3 lab barcode + analyzer interface · B4 discharge/OT templates · B7 cross-match & reaction reporting · C3 TPA claim pipeline ·
C1 online payments.

**Phase 4 — Platform (ongoing)**
E1 API layer + E2 webhooks · E10 ABDM/FHIR · E6 observability · E8 CI/test harness · D8 responsive/PWA.

---

## 4. Definition of done (shared)

Every item above ships with: acceptance criteria written first, automated test where the layer allows it,
documentation updated in this repo (`docs/`), a screenshot of the new state replacing the old one in `docs/assets/screens/`,
and an entry in `docs/CHANGELOG.md`.
