# @dizi/web — DiziHospital application shell

Phase 0 slice of the new UI. Running against deterministic synthetic data; every feature below is real
interaction, not a screenshot.

```bash
npm install                            # from the repository root
npm run dev --workspace @dizi/web      # http://localhost:3000  (binds 0.0.0.0)
NEXT_DIST_DIR=.next-build npm run build --workspace @dizi/web   # keep builds out of the dev server's .next
```

## Shell

| Feature | Where | Notes |
|---|---|---|
| **Sidebar: full ⇄ half (icons only)** | one toggle, top-left of the header — shown in rail mode only | Half mode is a 64 px icon rail with tooltips; the mode is remembered, and `Ctrl+B` switches it. `hidden` gives the table the entire width. There is deliberately no second control inside the sidebar, and the button is not rendered at all when the drawer is the way in |
| **Mobile bar** | fixed to the bottom edge in drawer mode — Home, Patients, Search and the Menu | The drawer opens *and closes* from the Menu column of that bar (the column turns into a close button), and also closes on Escape, on the backdrop, on any navigation, and when the shell crosses into rail mode. The bar paints *over* the drawer's backdrop and the panel stops above it, so the button that opened it stays visible and live. Focus moves into the panel and returns to the button; the page behind it cannot scroll. Nothing to do with the sidebar: there is no panel-shaped control in the mobile header at all |
| **Navigation mode — one decision** | `<html data-nav="rail\|drawer">` | The shell decides rail or drawer **once** — from `(min-width: 64rem)` *and* the pointer type — and writes it to the document element. `globals.css` paints from that attribute, with the same width query as its no-JS default, so the control that is on screen and the code behind it can never disagree. A touch device gets the thumb bar and the drawer at *any* width (a tablet in landscape is a thumb device, not a small desk), and in drawer mode the header shows no panel-shaped icon at all. Before this, "is the button visible" was decided by a class list and "what the button does" by `window.innerWidth`: that is how an Expand sidebar button came to sit on a phone doing nothing. `npm run test:shell` drives the decision at five widths and pointer types |
| **Fixed header** | always | Global search, connection state, hot actions, command palette, notifications, display controls, language, help, account |
| **Fixed footer** | always | The breadcrumb trail, version, phase, build stamp, credits, site mode, keyboard-shortcut link. The trail lives here rather than in the header so it stays visible at every width |
| **Global search** | header, `/` or click | Name, Bangla name, MRN and phone; results link straight to the record |
| **Command palette** | `⌘K` / `Ctrl+K` | Every route, plus role-aware "legacy · phase" chips |
| **Hot & action buttons** | `+` in the header, `Alt+1…4` | Register, book, bill, search |
| **Zoom control** | Display popover, `Alt+Z` | 80–150 %, remembered, applied to the working area only |
| **Text size control** | Display popover, `Alt+T` | A− / A / A+ / A++ — type only, independent of zoom |
| **Full screen** | Display popover, `Alt+F` | Real Fullscreen API |
| **Density** | Display popover | Comfortable/compact row and field heights, straight from the tokens |
| **Language switch** | header | English ⇄ বাংলা; navigation, shell and sync vocabulary are translated |
| **Wiki & help** | header `?`, `Shift+?` | Contextual guides from the mirrored help library, plus the full shortcut list |
| **Advanced tooltips** | everywhere | Title + description + shortcut chip; **disabled on touch devices** by design, and never the only source of a meaning |
| **App slider** | dashboard | Big desktop highlight panel: autoplay, arrows, dots, swipe, pauses on hover/focus/hidden tab, off for reduced-motion users |
| **Working area** | always | Fluid width, no max-width cap; hide the sidebar for full-width tables |

## Screens

| Route | What it demonstrates |
|---|---|
| `/` | App slider, tabs (Today / This week / This month), KPI tiles with definitions and "as of", live queue grid with inline edit and 3-dot actions |
| `/patients` | The full DataGrid (below), advanced filter panel with removable chips, saved views, bulk actions, tabs for duplicates/merges |
| `/patients/[mrn]` | Patient record: banner with allergy alerts, tabbed detail, editable contact block, visit history grid, read-only projections of legacy-owned modules, record metadata |
| `/patients/new` | Registration in five sections, live duplicate detection, honest offline ("Saved on this device" vs "Saved") |
| `/appointments` | The appointment desk: doctor × time calendar (desktop) and list (mobile), a drag-free queue board, online requests from the patient portal, and the full list — plus the booking sheet with real slot conflicts |
| `/login` | Two-step sign-in preview (credentials → six-digit code), branch picker, English ⇄ বাংলা |
| `/clinical` | OPD consultation: the room queue beside one patient's workspace — vitals with reference-range flags, SOAP notes, ICD-10 diagnosis, lab/imaging orders, and a prescription screened for allergies, high-alert medicines and dangerous abbreviations before it can be signed |
| `/diagnostics` | Laboratory and imaging worklist: every specimen's journey (ordered → collected → in the lab → resulted → verified → dispatched), per-analyte reference ranges checked as the value is typed, turnaround deadlines on the row, verification as a second-person gate, the critical-value call-back log, rejected samples with reasons, and the day's quality-control runs |
| `/inventory` | Stores and purchase: stock on hand per store with cover in days, batches with expiry (expired ones quarantined, valued, and written off with a reason), a replenishment list whose quantities cover the lead time, purchase orders with send/receive/cancel, goods receipt with a batch number and an expiry required on every line, the append-only store ledger, and a stock-take sheet a second person has to approve |
| `/ward` | The ward: a bed board per ward with the five bed states and the reason each one is in that state, admissions with a consultant and a reason (never just a bed number), observations scored with an early-warning aggregate that carries the response it requires and records the review when it happens, nursing notes that append rather than edit, a drug round that signs at the bedside (check recorded, witness for a controlled drug, reason for anything not given, indication for a PRN), handover as written SBAR with inherited tasks, transfers with two locations and an accepting name, and a discharge desk with a checklist, outstanding dues and a printable summary |
| `/reports` | Reports and dashboards: eight figures that each state their definition and their as-of stamp, patients-seen-per-day against bookings, case mix and workload by doctor, laboratory turnaround, critical-value call-back compliance and quality control, stock valuation and expiry risk, revenue split by method and payer with the discounts that needed an approver, and a data-quality tab that counts the record's own gaps and names who closes each one |
| `/pharmacy` | The dispensary: prescription queue, FEFO batch picking (expired batches cannot be selected), substitution with both names kept, controlled-substance register with a witness, and the append-only stock ledger |
| `/billing` | Billing counter: invoices built from what the doctor ordered, payment capture per method, discount approval above the limit, day-end sheet with cash reconciliation, and the branch tariff |
| `/help` | Help centre: how the new platform works (six anchored topics), the shortcut list, and the mirrored reference library by category |
| `/help/search` | Server-rendered search over the reference library, with the matching text highlighted |
| `/help/[category]/[slug]` | One mirrored article, rendered from Markdown with its screenshots served from the library, attributed to its source |
| `/print` and `/print/[doc]` | Print templates: registration slip and appointment slip (A5), prescription (A4), laboratory report (A4), purchase order (A4), discharge summary (A4), receipt (80 mm thermal), specimen label (50 × 25 mm), patient ID card (CR80), day list (A4 landscape) |
| `/<module>` | Launcher: modules still owned by the legacy system say so and point there |

## DataGrid

| Feature | Detail |
|---|---|
| **Fixed height** | The table scrolls inside its own region (`height` prop, default 58vh) with a sticky header and optional sticky first column, so the page bar never runs away |
| **Advanced search** | Quick search plus an expanding filter panel and removable filter chips — staff can see *why* the list is short |
| **Pagination** | First/prev/next/last, page-size selector (10/25/50/100), "showing x–y of n" and a jump-to-page box |
| **Inline edit** | Double-click or the pencil on editable cells; Enter saves, Esc cancels, saves are audited (and queued offline) |
| **3-dot row menu** | Full keyboard support (arrows, Home/End, Enter, Esc), separators for destructive actions, shortcuts and hints |
| **Sorting** | Click a header; `aria-sort` reflects it |
| **Columns** | Show/hide, reorder, search columns, reset, "show all" — remembered per table id |
| **Print** | Builds a clean A4-landscape document with filters, visible columns, timestamp and row count; falls back to the printed page if popups are blocked |
| **Export** | CSV with a UTF-8 BOM so Bangla exports open correctly in Excel |
| **Print CSS** | Shell chrome hidden, tables expanded and bordered, zoom forced to 100 % |

## Help centre and the mirrored library

Words, not code, are the other half of a handover. The help centre has two deliberately separate halves:

* **How the new platform works** — our own text, versioned with the app, so it can never describe a screen that
  no longer exists.
* **The reference library** — the legacy product's published documentation, mirrored into `docs/help-library/`
  and read at runtime by `lib/help.ts` (`/help`, `/help/search`, `/help/[category]/[slug]`,
  `/api/help-asset/[...path]`). Each page says that it documents the legacy product and links to its source.

Rules that keep the mirror *reference material* rather than product material:

* Nothing is copied out of `docs/help-library/` into product code — the wiki reads it, and the clean-room scan
  (`npm run clean-room`) still passes with the library present.
* The asset route resolves strictly inside `docs/help-library/assets`, so a crafted URL cannot walk out of it.
* Articles the library holds as title-only stubs say so on the page instead of rendering blank.
* The app must run where the repository's `docs/help-library/` is reachable (`lib/help.ts` looks next to and
  above the app directory); in a deployed image, mount it read-only.

## Checks

| Command | What it proves |
|---|---|
| `npm run verify` | clean-room scan, design tokens in sync, and no class list carrying two base display utilities |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | types |
| `NEXT_DIST_DIR=.next-build npx next build apps/web` | the production build — the alternate dist directory keeps a running dev server intact |
| `python3 tools/docs/check_links.py` | every relative link and image in `docs/` resolves |
| `npm run test:shell` | the shell's navigation, driven for real: five width/pointer scenarios, the drawer opening *and* closing from the bar, the rail collapsing *and* expanding, and the built stylesheet carrying the mode rules |
| `npm run test:runtime` | every route hydrates with no server/client mismatch and no console error, uncaught exception or unhandled rejection — with the clipboard deliberately rejecting, which is what an embedded frame does (needs the dev server on :3000) |

Both `test:` commands need `npm i --no-save jsdom esbuild`; they render the real components in jsdom, so they
prove state, handlers and class names but nothing about pixels — jsdom has no layout engine. They are deliberately
not part of `npm run verify`, because CI installs nothing today; wiring them in belongs with the P0 CI hardening.
The reports screen's as-of stamps are plain dates for the same reason: a wall clock read while rendering is one
value on the server and another in the browser, and React throws the rendered tree away when the two disagree.

## Deliberately not here yet

* No API calls: `lib/mock.ts` is deterministic synthetic data (2 000 patients) that disappears in `P0-301`;
  the grid already talks to a query callback, so it is a data-source change.
* No auth (Keycloak/OIDC is `P0-205`), so the role switcher and sign-out are placeholders.
* Grid row-level keyboard navigation (↑/↓/Enter) and virtualisation land with `P0-204` completion.
* Clinical terminology is not translated yet — that needs the reviewed glossary (`docs/plan/02` §9).
* Sign-in is a **preview**: no session is created and no password is checked. Keycloak/OIDC is `P0-205`, and the
  screen says so on itself.
* Print templates render real layouts from synthetic data; the barcodes are drawn from the identifier itself, not
  from a certified encoder (a real Code 128/QR encoder lands with the analyser and label-printer integration, `P4`).
* Help article feedback ("Was this helpful?") is inert — it needs the store and the editorial owner first.
* The laboratory worklist shows the controls it should show — reference ranges, turnaround deadlines, verification
  and the call-back log — but no analyser, label printer or SMS gateway is connected (`P4` integration hardening).
  Until then the values are typed by hand or filled from the synthetic generator.
* The reports are computed in the browser from the same deterministic generators as the operational screens, so
  they are always in step with them; on the real system the heavy aggregates run on the server (`P6`) and the
  screen reads a materialised summary instead. The scheduled-report panel is a specification, not a job runner.
* Reports have no drill-through yet: clicking a figure does not yet open the rows behind it (it goes to the
  operational screen instead), and there is no PDF or spreadsheet export beyond the browser's own print and the
  grid's CSV.
* The store module has no barcode or GS1 scanning yet: batch numbers and expiries are typed. Scanning is the
  point of the receiving bay (and of the analyser interface) and it lands with `P3` integration work.
* The ward module is a full workflow on synthetic patients: bed states, observations, notes, the drug round,
  handover, transfers and discharge all behave, and the discharge summary prints — but nothing is persisted
  (reload and the ward starts again) and no chart is signed with a clinician's own credentials. The offline queue
  the ward actually needs is the P0-210 prototype, and until it lands the screen says what a lost reload costs.
* There is no doctor's round screen yet: the observation escalation records who attended and what was done, and
  orders can be raised from the consultation workspace, but a ward round that writes orders, stops medicines and
  plans the day is still `P5`'s remaining work.
* No credit-note path for short-dated stock returned to a supplier, and no cold-chain temperature log — both are
  on the `P3` list, and both are visible in the data model's shape rather than hidden behind a claim.
* There is no separate laboratory role yet: the worklist is reached with the doctor/admin roles, and the actions on
  it stand in for a technologist and a pathologist. A dedicated role with its own permissions arrives with `P0-205`.
* The appointment desk, the consultation workspace, the laboratory worklist, the dispensary, the store and the billing counter all run on the same
  deterministic synthetic data as the rest of the shell: the rules are real, the patients, stock and money are not.
* Nothing on those screens is persisted — reload and the day starts again. The write paths (sign a note, record a
  movement, take a payment) are the shapes the API will accept, not a database yet.

## Conventions

* Styling is Tailwind + `@dizi/tokens` — no hard-coded colours, spacing or radii in components.
* Primitives live in `@dizi/ui`; a screen that needs a new pattern adds it there, not locally.
* Anything that writes data shows its sync state (`docs/plan/02` §11 rule 1).
* Tooltips are supplementary: every control keeps an accessible name without one.
* **One base display utility per class list.** Two `display` utilities of equal specificity are settled by the
  order of the rules in the stylesheet, not by the order in the `class` attribute — and in this build `.hidden`
  is emitted after `.grid`/`.flex` but *before* `.inline-grid`. So `cx(ICON_BTN, 'hidden lg:inline-grid')`, with
  `inline-grid` inside `ICON_BTN`, stays visible at every width: that is how an “Expand sidebar” button ended up
  in the mobile header, toggling a rail that does not exist there. Keep the display utility in the same string as
  `hidden` and put the other breakpoint behind a variant. `npm run check:classes` enforces this and runs inside
  `npm run verify` and CI.
