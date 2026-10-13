# Exploration Coverage Report

How the documentation in this repository was produced, exactly what it covers, and what it deliberately does not.

## 1. What was explored

| Dimension | Scope | Evidence |
|---|---|---|
| Screens | Every menu entry of the Super Admin sidebar: **76 screens** across 5 sections | `capture/index.json`, `capture/pages/*.jpg`, catalogued in `FEATURE-CATALOG.md` |
| Forms | Every add/edit form found on those screens, opened and profiled field by field | `capture/forms/*.json` (fields, types, required flags, option lists, validation messages) |
| Screen profiles | For each screen: page title, tabs, tables + columns, panels, buttons, filters, forms, charts | `capture/pages/*.json` |
| Record views | Real records opened from lists (IPD case, patient profile, billing screens) with all their tabs | `capture/detail/*`, `capture/detail2/*` |
| Sub-screens | Screens reachable but not in the menu (per-module billing, patient import, discharged register, sale returns, searches, payroll …) | `capture/subs/*` |
| Roles | All nine demo staff roles: dashboard, full menu tree, six real screens each | `capture/roles/*` |
| Public site | Home, department/doctor/news/contact pages, patient-portal sign-in | `capture/frontsite/*` |
| Navigation truth | Rendered sidebar tree (sections → items → sub items) | `capture/nav.json` |
| Vendor reference | Product documentation, help articles and system requirements | https://smart-hospital.in/docs/ and /articles |
| Vendor help library | The complete article library mirrored into the repo (categories, articles and screenshots) | `docs/help-library/`, index in `docs/HELP-LIBRARY.md` |

## 2. How it was captured

The demo host is not reachable from the authoring sandbox, so capture runs on a GitHub Actions runner with full
internet access and commits its output back to this branch:

* `tools/capture/recon.js` — sign-in recon, sidebar + link inventory, dashboard structure dump.
* `tools/capture/crawl.js` — walks the entire menu, screenshots each screen and extracts its structural profile; resumes and auto-commits so a kill never loses the run.
* `tools/capture/forms.js` — opens the page-specific add/edit dialogs, profiles every field, walks screen tabs, then opens real records and walks their tabs.
* `tools/capture/roles.js` — logs in as each of the nine roles, records the dashboard, the menu tree and samples of reachable screens; also captures the public site and patient portal sign-in.
* `tools/capture/subs.js` — captures sub-screens that are not menu entries plus deeper record views.
* `tools/docs/build_docs.py` — turns the evidence into `FEATURE-CATALOG.md` and the curated screenshot set.
* `tools/docs/build_html.py` + `tools/docs/pdf.js` — render the guide HTML and print it to `Smart-Hospital-Complete-Guide.pdf`.

Sign-in used: `superadmin@gmail.com` / `password` on `demo.smart-hospital.in` (public vendor demo).
Workflows: `.github/workflows/capture-*.yml` and `.github/workflows/build-pdf.yml`.

## 3. Reproduce / refresh

```bash
# 1. capture (GitHub Actions, needs a runner with internet access to the demo host)
gh workflow run capture-crawl.yml --ref <branch>
gh workflow run capture-deep.yml  --ref <branch>
gh workflow run capture-subs.yml  --ref <branch>

# 2. rebuild documents locally
python3 tools/docs/build_docs.py     # FEATURE-CATALOG.md + docs/assets/screens
python3 tools/docs/build_html.py     # docs/build/guide.html
node tools/docs/pdf.js               # docs/Smart-Hospital-Complete-Guide.pdf (needs playwright chromium)
```

## 4. Known limitations of this exploration

1. **Read-mostly exploration.** Forms were opened and profiled but not submitted, so the demo data was not polluted. Where a screen shows data, it is the demo's own sample data.
2. **Enumerated option lists are truncated** (first ~6–30 values) to keep the documents readable; the complete lists are in the JSON profiles.
3. **Vendor-only screens** (licence/purchase-code and addon registration modals) were deliberately excluded from the feature catalogue — they are product-licensing artefacts, not hospital features.
4. **Some workflows need configuration to demonstrate**, e.g. Zoom teleconsultation needs API keys, SMS/e-mail need gateway credentials; these screens are documented from their UI, not from live message delivery.
5. **Report contents** depend on the demo's date range; the catalogue documents structure (filters, columns, actions) rather than the numbers shown.
6. **Patient portal depth** is limited to the sign-in screen because the demo publishes no patient credentials; self-service screens inside the portal are covered as "to verify" in the backlog.
7. **Mobile app:** the vendor also ships a **Smart Hospital Android app** (documented under the *Smart Hospital Android App* changelog category and referenced by the WhatsApp/notification articles). It was **not** captured in this pass because it is not reachable from the web demo — it is listed as coverage debt in the improvement backlog (E13).
8. **Vendor-only features not visible in the demo:** WhatsApp Messaging, Two-Factor Authentication, e-mail/SMS gateways and the installation wizard cannot be exercised on the public demo (no credentials/keys). They are documented here from the vendor help library (`docs/help-library/`), and flagged in the backlog where verification is still required.
9. **Not covered:** the CodeCanyon installation wizard internals (documented by the vendor), server/infrastructure configuration, and anything requiring database-level access.

## 5. Vendors' own help library (mirrored)

`tools/docs/fetch_help.py` mirrors `smart-hospital.in/articles` — every category, every article and its screenshots —
into `docs/help-library/`, rewritten to local Markdown with local images so the knowledge base works offline and can be
diffed over time. `docs/HELP-LIBRARY.md` is the generated index, and a curated selection is printed in Part 4 of the PDF.

```bash
python3 tools/docs/fetch_help.py          # re-run in an environment that can reach smart-hospital.in
python3 tools/docs/build_help_library.py  # rebuild docs/HELP-LIBRARY.md from the mirror
```

## 6. Repository layout

```
capture/                 raw evidence (screenshots + JSON profiles + logs)
  index.json             76-screen manifest
  nav.json               rendered sidebar tree
  pages/                 one .jpg + one .json per screen
  forms/                 add/edit dialog captures
  detail/, detail2/      record views and their tabs
  subs/                  sub-screens not present in the menu
  roles/                 per-role dashboard + menu + samples
  frontsite/             public website + patient portal
docs/                    deliverables
  FEATURE-CATALOG.md     screen-by-screen, form-by-form catalogue
  WIKI.md                operator handbook / help wiki
  IMPROVEMENT-BACKLOG.md prioritised findings for the next phase
  COVERAGE.md            this file
  Smart-Hospital-Complete-Guide.pdf
  assets/screens/        curated screenshots used by the documents
tools/                   capture + document pipelines
```
