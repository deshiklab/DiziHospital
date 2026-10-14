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
| **Sidebar: full ⇄ half (icons only)** | toggle in the header or the sidebar header | Half mode is a 64 px icon rail with tooltips; the mode is remembered, and `Ctrl+B` switches it. `hidden` gives the table the entire width |
| **Mobile navigation** | hamburger in the header | Off-canvas drawer, closes on navigation |
| **Fixed header** | always | Breadcrumbs, global search, connection state, hot actions, command palette, notifications, display controls, language, help, account |
| **Fixed footer** | always | Version, phase, build stamp, credits, site mode, keyboard-shortcut link |
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
| `/help` | Help centre: how the new platform works (six anchored topics), the shortcut list, and the mirrored reference library by category |
| `/help/search` | Server-rendered search over the reference library, with the matching text highlighted |
| `/help/[category]/[slug]` | One mirrored article, rendered from Markdown with its screenshots served from the library, attributed to its source |
| `/print` and `/print/[doc]` | Print templates: registration slip and appointment slip (A5), prescription (A4), receipt (80 mm thermal), specimen label (50 × 25 mm), patient ID card (CR80), day list (A4 landscape) |
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

## Deliberately not here yet

* No API calls: `lib/mock.ts` is deterministic synthetic data (2 000 patients) that disappears in `P0-301`;
  the grid already talks to a query callback, so it is a data-source change.
* No auth (Keycloak/OIDC is `P0-205`), so the role switcher and sign-out are placeholders.
* Grid row-level keyboard navigation (↑/↓/Enter) and virtualisation land with `P0-204` completion.
* Clinical terminology is not translated yet — that needs the reviewed glossary (`docs/plan/02` §9).
* Sign-in is a **preview**: no session is created and no password is checked. Keycloak/OIDC is `P0-205`, and the
  screen says so on itself.
* Print templates render real layouts from synthetic data; the barcodes are drawn from the identifier itself, not
  from a certified encoder (that lands with the laboratory module, `P4`).
* Help article feedback ("Was this helpful?") is inert — it needs the store and the editorial owner first.
* The appointment desk runs on the same deterministic synthetic data as the rest of the shell: the scheduling
  rules are real, the appointments are not.

## Conventions

* Styling is Tailwind + `@dizi/tokens` — no hard-coded colours, spacing or radii in components.
* Primitives live in `@dizi/ui`; a screen that needs a new pattern adds it there, not locally.
* Anything that writes data shows its sync state (`docs/plan/02` §11 rule 1).
* Tooltips are supplementary: every control keeps an accessible name without one.
