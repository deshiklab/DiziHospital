# @dizi/web — DiziHospital application shell

The new UI's P1–P6 screens, running against deterministic synthetic data; every feature below is real
interaction, not a screenshot. The platform beneath them (auth, API, database, CI) is still P0 work — the
coverage table at the end of this file says exactly what is real, what is a preview and what is still ahead.

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
| **Sync pill** | header, always | Reads the real engine now: *Synced* / *Waiting to sync (n)* / *Needs review* / *Local* / *Syncing* come from the outbox and the conflict list rather than a switch. The popover still lists the queued writes and drains them; the six states remain selectable there for review |
| **Fixed header** | always | Global search, connection state, hot actions, command palette, notifications, display controls, language, help, account |
| **Fixed footer** | always | The breadcrumb trail, version, phase, build stamp, credits, site mode, keyboard-shortcut link. The trail lives here rather than in the header so it stays visible at every width |
| **Global search** | header, `/` or click | Name, Bangla name, MRN and phone; results link straight to the record |
| **Sub-screens** | under the module in the sidebar, and in the palette | A route that belongs to a module rather than being a module of its own (`/billing/opd`, `/pharmacy/returns`, `/patients/discharged`) is declared as a child of its parent in `lib/nav.ts`. It appears under the module while the module is open, in the command palette as a searchable destination with its parent named, and in the breadcrumb as a place rather than as a path — one declaration, three uses, so a route cannot exist in the sidebar and be missing from search |
| **Command palette** | `⌘K` / `Ctrl+K` | Every route — modules and their sub-screens — plus role-aware "legacy · phase" chips |
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
| `/patients/new` | Registration in five sections, live duplicate detection against the contract's own rule set (each candidate arrives with the evidence that raised it and its score), honest offline ("Saved on this device" vs "Saved") |
| `/patients/import` | Legacy register import: column mapping guessed from the header and overruled by hand, row-by-row validation against the same rule set the desk form runs, an MRN clash reported as a mistake in the file, rows that collide with *each other* flagged as well as with the register, the rows that need fixing downloadable as a CSV, and a dry run that writes nothing |
| `/patients/discharged` | The discharged register: today, this week or the whole record, with the summary gaps, the results still pending, the calls to make, the follow-ups not booked, the dues outstanding and the readmissions inside 30 days — and the discharge summary itself behind each row |
| `/appointments` | The appointment desk: doctor × time calendar (desktop) and list (mobile), a drag-free queue board, online requests from the patient portal, and the full list — plus the booking sheet with real slot conflicts |
| `/appointments/queue` | The live queue: who is next and in which room, waiting times measured rather than guessed, tokens called and skipped and requeued, walk-ins triaged into the line without ever jumping it, and the check-in-to-consultation timeline on each token |
| `/login` | Two-step sign-in preview (credentials → six-digit code), branch picker, English ⇄ বাংলা |
| `/clinical` | OPD consultation: the room queue beside one patient's workspace — vitals with reference-range flags, SOAP notes, ICD-10 diagnosis, lab/imaging orders, and a prescription screened for allergies, high-alert medicines and dangerous abbreviations before it can be signed |
| `/diagnostics` | Laboratory and imaging worklist: every specimen's journey (ordered → collected → in the lab → resulted → verified → dispatched), per-analyte reference ranges checked as the value is typed, turnaround deadlines on the row, verification as a second-person gate, the critical-value call-back log, rejected samples with reasons, and the day's quality-control runs |
| `/diagnostics/search` | Pathology and radiology search: verified results only by default, values against the analyte's own reference range, the previous verified result beside each one, trends that compare like with like, imaging reports read by the question that was asked, and the list of critical results nobody has telephoned about yet |
| `/inventory` | Stores and purchase: stock on hand per store with cover in days, batches with expiry (expired ones quarantined, valued, and written off with a reason), a replenishment list whose quantities cover the lead time, purchase orders with send/receive/cancel, goods receipt with a batch number and an expiry required on every line, the append-only store ledger, and a stock-take sheet a second person has to approve |
| `/ward` | The ward: a bed board per ward with the five bed states and the reason each one is in that state, admissions with a consultant and a reason (never just a bed number), observations scored with an early-warning aggregate that carries the response it requires and records the review when it happens, nursing notes that append rather than edit, a drug round that signs at the bedside (check recorded, witness for a controlled drug, reason for anything not given, indication for a PRN), handover as written SBAR with inherited tasks, transfers with two locations and an accepting name, and a discharge desk with a checklist, outstanding dues and a printable summary |
| `/round` | The doctor's round: the list ordered by how sick the patient is rather than by bed number, per-patient charts and results on one page, orders, and the consultant review and ceiling-of-care decisions the round has to document |
| `/ot` | Theatre: the day's list with its gates (consent, site, anaesthesia, nil by mouth, investigations), sign-in / time-out / sign-out, swab and instrument counts that refuse a mismatch, implants and specimens, recovery with a score that gates the return to the ward, and cancellations and bumping with reasons |
| `/duty` | The duty roster: who is on each shift and in which role, the skills each area requires, the minimum rest between shifts, and the gaps that need filling before the shift starts |
| `/bloodbank` | The blood bank: compatibility computed from antigens and antibodies with the reason for every refusal, the unit register with shelf life and the out-of-fridge clock, donor criteria and deferrals, cross-match requests with a sample that can go stale, issue and return with quarantine, and a trace that runs both ways |
| `/ambulance` | Ambulance dispatch: the vehicle board with states and readiness checks, the call queue with response times measured against the P1 target, the fare table, and decontamination and turnaround times that cannot be billed |
| `/setup` | Setup: every “Setup › …” catalogue as one registry with one audit trail — charge master, drugs, items, tests, ICD-10, symptoms, findings, vitals, blood products, wards, bed classes and theatres — plus the income and expense head masters finance posts to, where a code is an identity, nothing is deleted, and a price change is a dated row |
| `/setup/finance` | Setup › Finance: the income and expense heads as one dated list, and the two fields that carry money — the billing category an income head collects, which is the mapping the day-end reconciliation matches counter takings against, and the withholding and VAT on an expense head, which apply from the date on the voucher rather than from the list. A category no head collects is named as the safety banner it is (it lands in “other operating income” and reads as missing documents at day end), and the coverage panel shows which head the reconciliation credits when two claim the same one. A capital head may not become revenue while its assets are on the register, a category may not be re-labelled while the period has money in it, and a rate the law does not have is refused |
| `/setup/referral-commission` | Setup › Referral: who may be paid a commission, on which heads, at what rate and under which dated agreement — agreement number, term, ceilings, payout account, the statutory withholding floor, the hold that lets a patient refund net off, and two names on the file before anything may be approved. A lapsed agreement pays nothing until it is renewed (the renewal appends a dated version rather than editing the old one), a suspension needs a reason on the record, and pharmacy, donations and sundry income can never be named |
| `/sync` | Sync console (P0-210/211): the offline outbox with operation ids and per-node sequence numbers, reserved MRN/invoice number blocks, a drain that drops a replay instead of applying it twice, the three conflict policies (append-only · field-level · exclusive) with both values side by side and a person to decide, and the plan's outage drill runnable on demand — it reports whether any write was lost |
| `/finance` | Money today: the day book (opening float, receipts, payments, deposit due, banked this morning), the drawer separated from the bank and from what payers owe, and the reconciliation *first* — every counter against the module that knows what it should have taken, three verdicts (agrees · explained by the queue · investigate), and a count-the-drawer control where a person types what is actually in the box and a short drawer is named instead of adjusted |
| `/finance/income` | Income vouchers: one chronological, gaplessly numbered series per node, a head for every receipt (no “miscellaneous”), counter income that no invoice knows about reported as such, reversals as contra vouchers that name the original, the reason and the approver, and queue-aware states throughout |
| `/finance/expenses` | Expense vouchers: the approval ladder decided by amount (accounts officer → finance manager → director with a second signature and a quotation), self-approval and one-person-two-signatures refused by name, withholding and VAT deducted at payment, the cash payment limit, the capitalisation floor, and a live verdict on the voucher being written |
| `/finance/tpa` | TPA and insurance claims: the register is built from the payer bills the modules raised, aged from the day each claim was filed against the payer's own settlement period, with the two oldest ageing buckets named as empty because this branch has no bill that old. Five saved views, a search across claim, bill, MRN, payer and pre-authorisation number, and a pager — the register is a receivables ledger, not a day list. Submitting is refused with the payer's own rule when pre-authorisation is missing above the threshold or a document is absent, an interim estimate for a patient still in a bed is refused because a claim is a bill and an estimate is not, and a short payment stays open until it is absorbed by somebody named, moved to the patient, or reworked |
| `/finance/referral` | Referral commission: who may be paid, on which heads, at what rate and under which dated agreement; accruals computed on money collected rather than billed, from both counter registers, with pharmacy, donations and sundry income refused by name, an in-house consultant refused the double dip, a fortnight's hold so a patient refund can net off, and withholding that leaves with the payment. The payout run pays what has become payable, shows what is held, and refuses a voucher with no reference or the same person preparing and approving it |
| `/reports` | Reports and dashboards: eight figures that each state their definition and their as-of stamp, patients-seen-per-day against bookings, case mix and workload by doctor, laboratory turnaround, critical-value call-back compliance and quality control, stock valuation and expiry risk, revenue split by method and payer with the discounts that needed an approver, and a data-quality tab that counts the record's own gaps and names who closes each one |
| `/pharmacy` | The dispensary: prescription queue, FEFO batch picking (expired batches cannot be selected), substitution with both names kept, controlled-substance register with a witness, and the append-only stock ledger |
| `/pharmacy/search` | Medicine search: which store holds it and how long until it expires, what may legally be substituted (same generic and strength, never a controlled drug), a live allergy check against the patient's record, and the unit price — with consumables and reagents searched the same way |
| `/pharmacy/returns` | Sale returns and credit notes: the seven-day window with the bill, sealed packs only, cold-chain items never restocked, controlled medicines destroyed with a witness instead of returned, nothing on the shelf without a decision, and the credit going back by the method the money came in |
| `/billing` | Billing counter: invoices built from what the doctor ordered, payment capture per method, discount approval above the limit, day-end sheet with cash reconciliation, and the branch tariff |
| `/billing/opd` | The OPD counter (legacy screens 001 / 002 / 008): the checked-in pick-list, lines added from the tariff, the discount with a reason and an approver above the limit, the collection gate that stops a sample on an unpaid bill, take money, issue and print the receipt, and per-line refunds |
| `/billing/opd-patient` | The OPD patient account: every visit, charge, payment and refund on one page with the receipt numbers, the payer's share beside the patient's, and waivers shown as zero-value lines rather than as absences — the screen that answers “I have already paid for this” |
| `/billing/appointments` | Appointment billing: what each booking costs and why (new, follow-up inside the window, report review, procedure package), the booking fee as a commitment rather than revenue, the cancellation cut-off, the no-show rule, the corporate cap and the co-pay, and the consultant share computed on money collected rather than money billed |
| `/billing/modules` | Single-module billing (legacy screens 010, 003, 004, 005 and 006): bill pathology, radiology, blood issue, blood components, pharmacy, IPD or ambulance from the worklist that produced each item, when each module charges and who owes it, pre-authorisation above the insurance threshold, credit limits, deposits, and an emergency override that carries a name |
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
| `npm run test:shell` | the shell's navigation, driven for real: five width/pointer scenarios (the real shell bundled and rendered, so these need no server), the drawer opening *and* closing from the bar, the rail collapsing *and* expanding, and — from the served page — the built stylesheet carrying the mode rules. If `DIZI_BASE` is set and nothing answers, that is a failure rather than a note: a suite that quietly checks less than it claims is worse than a short suite |
| `npm run test:rules` | the duplicate rule set, exercised: the real engine bundled and one crafted case per rule the contract declares, plus the combination rule (a phone match and a one-edit name add up to a capped 1.0 and block), the veto (a shared phone number whose sexes disagree warns rather than blocks), the MRN exception, and the import running the same rules — including a row that collides with a row above it in the same file. Needs `jsdom`’s sibling: `esbuild` |
| `npm run test:finance` | the money rules, exercised: the real module bundled, then the approval ladder (amount → role → second signature → quotation, one person signing twice refused, nobody approving their own voucher, cash above the counter limit refused whatever the signature), withholding and VAT (deducted at payment, payable = gross + VAT − withholding), the three reconciliation verdicts (a complete book that agrees · a receipt still queued on the device that took it · a drawer counted short, which no queue explains), the fourteen-day window the finance reports will read, totalled against the days it covers, the claim register (every claim traceable to a bill, ageing counted from the filing rather than the service, pre-authorisation and documents refused by name, one invoice claimed once per payer, a short payment carried whole by the hospital or not at all and always with a reason code, and a rejection left open until somebody accepts it), and the referral register (commission on collected money only, a head that is never commissioned earning nothing whoever the agreement names, a head outside the agreement the same, the in-house consultant refused the double dip, the fortnight's hold, and withholding at the professional rate), and the two setup screens' rules (every head and every agreement on file put through the rules its own screen enforces, one code not sitting on both sides of the book, tax refused on an income head, a category change refused while the period has money in it and allowed once it is dated after the period, a capital head that may not become revenue with assets on the register, a withholding or VAT rate the law does not have refused, the coverage reading naming the head the reconciliation credits, a gap closing when a head collects it, the heads no agreement may name matching the register's own list, a lapsed agreement paying nothing until it is renewed, and withholding never below the statute) |
| `npm run test:runtime` | every route hydrates with no server/client mismatch and no console error, uncaught exception or unhandled rejection — with the clipboard deliberately rejecting, which is what an embedded frame does. On `/finance` it presses *Record a counter receipt*, posts it through the contract and asserts the day's verdict moved from *Every counter agrees* to *Explained by the queue*, naming the voucher (`ledger=`). On `/finance/tpa` it switches to the saved view for claims awaiting pre-authorisation, tries to submit an interim estimate and asserts the refusal is the payer's own rule, then submits a draft claim and asserts it left *Draft*, reports the claim by name, and reached the device's saved queue as `submitClaim` (`claims=`). On `/setup/finance` it presses *Decide where it lands*, opens the unmapped category's row action, asserts the form that opens already collects that category, creates the head and asserts the gap list closes on the screen that reported it (`heads=`). On `/sync` it also presses *Run the drill* and asserts the engine reported zero lost writes, plants a queue in `localStorage` before the page loads and asserts the console renders it back (`queue=rehydrated`), writes one through the contract and asserts it reaches storage (`persist=`), asserts that **every** queued write names an operation the contract declares (`named=`, read against `packages/contracts/dist/capabilities.json` rather than a list kept in the harness), drives a refused claim through to *Queue it again* and asserts it returns under a fresh id (`retry=`), and presses an action the contract marks online-only to assert the refusal carries the contract's own sentence (`refusal=`). It reads `DIZI_BASE` (the dev server on :3000 by default), waits on the app's own hydration signal rather than on a stopwatch, and checks four routes at a time: 8 s against a production build, half a minute against a warm dev server |

Both `test:` commands need `npm i --no-save jsdom esbuild` and accept `DIZI_BASE`; they render the real components
in jsdom, so they prove state, handlers and class names but nothing about pixels — jsdom has no layout engine. They
are deliberately not part of `npm run verify`, which stays dependency-free; they run as their own CI job, against
the production build, so the artefact that ships is the artefact that is tested.
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
* The sync engine's *protocol* is implemented and exercised — operation ids, sequence numbers, idempotent replay, number blocks, the three conflict policies, refusals with a named holder, and (P0-306) a queue that is **saved on the device** under `dizi.outbox.v1`, so a reload keeps what is waiting. Whether a write *may* be queued is read from the API contract (`@dizi/contracts`), not from a rule in the screen: an operation the contract marks `online-only` is refused synchronously with the contract's own sentence, before anybody taps it. The *transport* is still simulated: there is no server and the peer is a `SimulatedCloud` inside this build. The plan's exit criterion (an outage drill on a real edge node with a real uplink pulled for an hour) is still ahead; the screen says so on itself.
* Duplicate detection is **one module** (`lib/duplicate-rules.ts`) called by registration and by the CSV import, with the rules, the weights and the two thresholds read from the contract — not two implementations that agree by accident, which is what they were until this landed: the form checked a phone number and a national-ID suffix, the import checked a normalised phone and name + age + sex. Measurement before/after on the sample file: identical (17 ready, 2 possible duplicate, 2 rejected), because the consolidation fixes the divergence rather than changing the verdicts. What *is* new is that a row is now checked against the rows above it in the same file too — two rows for one patient in one spreadsheet used to both come in — and that a vetoing rule says so in words: a shared phone number whose sexes disagree reads *"probably two people, so check before merging"*, not "possible duplicate".
* Every queued write names the contract operation it replays as, and the console shows the mapping (`OPERATION → method path · policy`). Thirteen sites name a real domain write — an invoice raised, a payment taken, a dose signed, a bed claimed, a follow-up booked, a round plan appended, a return credited as a credit note; the remaining eleven call `queueWrite(label)` with no operation and are recorded as what they are: an audit entry (`appendAuditEntry`), which the contract declares queueable and audited. If the contract refuses a named operation the desk reads its sentence and the action still lands in the ledger, because a desk action leaving no trace is worse than one recorded against the wrong document. A refused write has a **Queue it again** control: it returns as a *new* `nodeId:seq`, since the old id was spent on the refusal.
* The ward module is a full workflow on synthetic patients: bed states, observations, notes, the drug round,
  handover, transfers and discharge all behave, and the discharge summary prints — but nothing is persisted
  (reload and the ward starts again) and no chart is signed with a clinician's own credentials. The offline queue
  the ward actually needs is the P0-210 prototype, and until it lands the screen says what a lost reload costs.
* The doctor's round (`/round`) writes orders, reviews results, sets the ceiling of care and prints the round
  list — but it is not yet *the* record: the round note it produces is a preview, and no ward round is signed with
  a clinician's own credentials until `P0-205`.
* `/pharmacy/returns` issues credit notes for **sales** returns — the seven-day window, sealed packs, cold-chain
  lines quarantined rather than restocked, controlled medicines destroyed with a witness, the credit going back by
  the method the money came in. Two `P3` gaps remain and neither is hidden: there is no credit-note path for
  short-dated stock returned **to a supplier**, and no **cold-chain temperature log** for the fridges and the
  vaccine carrier.
* There is no separate laboratory role yet: the worklist is reached with the doctor/admin roles, and the actions on
  it stand in for a technologist and a pathologist. A dedicated role with its own permissions arrives with `P0-205`.
* The appointment desk, the consultation workspace, the laboratory worklist, the dispensary, the store and the billing counter all run on the same
  deterministic synthetic data as the rest of the shell: the rules are real, the patients, stock and money are not.
* Nothing on those screens is persisted — reload and the day starts again. The write paths (sign a note, record a
  movement, take a payment) are the shapes the API will accept, not a database yet.

## Phase coverage — P1 to P6

The plan's phases are sequences of screens (`docs/plan/03-SCREEN-MAP.md`). This is where that plan stands in the
preview: what is built, and what the same phase still owes.

| Phase | Delivered in this build | Still owed by the phase |
|---|---|---|
| **P1** Identity, patients, appointments | `M` Patient register, profile, registration with live duplicate detection, `/patients/import` (legacy register import with a dry run), `/patients/discharged` (the discharged register, recalls, dues and readmission flags), `/appointments` (the desk, the calendar, online requests), `/appointments/queue` (tokens, rooms, waiting times, walk-in triage), sign-in preview | Real SSO/MFA (`P0-205`), the API behind registration and booking, duplicate merging that writes, and the appointment reminder channel |
| **P2** Billing and OPD consultation | `/clinical` (the consultation workspace), `/billing` (invoices, payment capture, discount approval, day end, tariff), `/billing/opd` (the OPD counter: pick-list, lines, collection gate, receipt, per-line refunds), `/billing/opd-patient` (the patient's own account), `/billing/appointments` (booking fees, the cancellation cut-off, the no-show rule, consultant share on collected money), `/billing/modules` (module billing), `/setup` (charge master among the twelve catalogues) | Non-cash settlement (insurance claim submission, corporate statements), the referral payout run, and the tariff's effective-dating wired to a store rather than to a catalogue |
| **P3** Pharmacy and inventory | `/pharmacy` (dispensary: FEFO picking, substitution, controlled register), `/pharmacy/search` (medicine search with stock, substitutes and a live allergy check), `/pharmacy/returns` (sale returns and credit notes), `/inventory` (stores, batches, expiry, reorder, purchase orders, goods receipt, ledger, stock take), `/setup` item and drug catalogues | Barcode/GS1 scanning at the receiving bay, supplier credit notes, the cold-chain log, and the POS hardware (cash drawer, label printer) |
| **P4** Laboratory, imaging, blood bank, ambulance | `/diagnostics` (specimen journey, reference ranges, verification gate, call-backs, QC), `/diagnostics/search` (pathology and radiology search with trends and uncalled criticals), `/bloodbank` (compatibility, shelf life, donors, cross-match, issue, trace), `/ambulance` (vehicles, calls, response times, fares), `/billing/modules` (pathology, radiology, blood issue and blood component billing), `/setup` laboratory, imaging, ICD-10, symptoms, findings and blood-bank catalogues | Analyser and PACS interfaces, barcode specimen labels from a certified encoder, the blood-bank look-back report as a document, and the imaging calendar's real modality capacity |
| **P5** In-patient, ward, theatre | `/ward` (bed board, admissions, observations with an early-warning score, notes, drug round, handover, transfers, discharge desk), `/round` (order of the round, charts, orders, ceiling-of-care decisions), `/ot` (theatre list with gates, counts, implants, recovery and cancellations), `/duty` (roster, skills, rest between shifts), `/setup` bed classes and theatres | The nursing care plan, theatre consumable billing to the case, the ICU chart, and the ward's offline queue on the real edge node (`P0-210`) |

| **P6** Finance, insurance and reporting | `/finance` (the cash book: day book, three counters reconciled, drawer counted, three verdicts), `/finance/income` (receipts, heads, reversals), `/finance/expenses` (the approval ladder, withholding and VAT, capital vs revenue), `/finance/tpa` (the payer claim pipeline: pre-authorisation, documents, ageing against each payer's promise, short payments assigned to a name), `/finance/referral` (commission on money collected, per head, under a dated agreement, with a hold and withholding), `/setup/finance` (income and expense heads, the category mapping the reconciliation reads, dated withholding rates), `/setup/referral-commission` (agreements with terms, ceilings, versions and refusals), and `/setup` for the same data as catalogues plus the payer agreements. Five contract operations and four entities were added for it — `POST /ledger/income`, `POST /ledger/expense` (append-only), `POST /claims` (exclusive: one invoice, one claim, per payer), `POST /claims/{claimNo}/response`, `POST /commission/payouts` (append-only) — all queueable and audited | The seventeen report screens reading this window and the API itself, which is what turns “the book” from a generator into a table |
Everything above is a **preview**: the rules, refusals and arithmetic are real, the patients, stock, money and
blood are not, and a reload starts the day again. The write paths are the shapes the API will accept. What each
screen refuses — and why — is in the screen itself, not only in this file.

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
