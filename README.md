# DiziHospital

Working repository for **improving the Smart Hospital hospital-management system**.

The starting point is an evidence-based exploration of the product: every screen, every form, all roles and the public
site were captured from the live demo, documented, and turned into a printable guide. The improvement backlog is the
agenda for the next phase.

## Deliverables

| Document | What it is |
|---|---|
| **[docs/Smart-Hospital-Complete-Guide.pdf](docs/Smart-Hospital-Complete-Guide.pdf)** | The full PDF guide — cover, contents, operator wiki/help handbook, screen-by-screen feature catalogue with screenshots, and the improvement backlog |
| [docs/FEATURE-CATALOG.md](docs/FEATURE-CATALOG.md) | Markdown feature catalogue: 76 screens, 96 data-entry dialogs, 29 sub-screens, 5 record views (with every tab), all 9 role dashboards — each screen documented with its purpose, grids, filters, actions and form fields, plus a screenshot |
| [docs/WIKI.md](docs/WIKI.md) | Operator handbook / help wiki — how to run each module day to day (registration, appointment, OPD, IPD, billing, pharmacy, lab, imaging, blood bank, HR, finance, reports, CMS, telemedicine), troubleshooting and glossary |
| [docs/IMPROVEMENT-BACKLOG.md](docs/IMPROVEMENT-BACKLOG.md) | Findings and a prioritised backlog (P0/P1/P2) with proposals, sizes and a phased sequence — the plan for improving the application |
| [docs/COVERAGE.md](docs/COVERAGE.md) | How the capture was done, what is covered, what is out of scope, and how to refresh it |

## What the application is

**Smart Hospital** (vendor: QDOCS) is a PHP/CodeIgniter + MySQL hospital-management suite covering:

* **Core operations** — dashboard, patient master index, billing, appointments, OPD and IPD clinical desks
* **Clinical** — pharmacy, pathology, radiology, blood bank, ambulance, front office
* **Administration** — birth/death registers, multi-branch, HR (staff, QR attendance, duty roster, payroll, leaves), referral, TPA/insurance, income/expense
* **Tools & content** — surveys, notice board, download centre, inventory, certificates, ID cards, Front CMS website, Zoom telemedicine
* **Reports & setup** — 17 reports and the master/lookup configuration for every module
* Roles: Super Admin, Admin, Doctor, Nurse, Pharmacist, Pathologist, Radiologist, Accountant, Receptionist + patient portal

## Evidence and tooling

```
capture/      raw evidence from the live demo (screenshots + JSON profiles + logs)
docs/         deliverables and curated screenshots (docs/assets/screens)
tools/capture Playwright capture pipeline (recon, crawl, forms, roles, sub-screens)
tools/docs    document pipeline (catalogue → print-ready HTML → PDF)
.github/workflows  the CI jobs that run capture and build the PDF
```

The demo host is reachable from GitHub Actions runners but not from every environment, so capture jobs run in CI and
commit their output back to the branch. See [docs/COVERAGE.md](docs/COVERAGE.md) for the exact commands.

## Next steps

1. Review the backlog and agree on Phase 1 scope (trust & safety items: KPI correctness, currency/locale, safe delete, allergy checks, smarter patient search, security baseline, backups).
2. Decide the platform direction recorded in `IMPROVEMENT-BACKLOG.md` §E3 (harden the current stack vs. a strangler re-platform) and write it up as a decision record.
3. Stand up the CI/test harness (backlog E8) so every improvement ships with an automated check and a refreshed screenshot in this repository.
