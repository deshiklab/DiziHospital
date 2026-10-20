# Screen migration map

Every screen captured from the running application, assigned to the delivery phase that will replace it, sized from the captured evidence (form fields, grid columns, tabs, dialogs) and annotated with the components the new UI needs for it.

Sizes are planning estimates: **S ≈ 3**, **M ≈ 7**, **L ≈ 14** engineer-days for one screen including API, tests and design QA.

## P0 — Foundations

Design system, app shell, identity, environments, API conventions. No legacy screen is replaced yet.

**Scope:** 0 application screens · 0 sub-screens · **≈ 0 engineer-days** (excluding platform work and design system).


## P1 — Identity, patients, appointments

Sign-in/SSO, MFA, role-aware home, patient master (register/search/profile/import), appointment booking + queue.

**Scope:** 3 application screens · 3 sub-screens · **≈ 49 engineer-days** (excluding platform work and design system).

| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |
|---|---|---|---|---|---|---|---|---|---|
| **Appointment** | `/admin/appointment/index` | L | 51 | 3 | 15 | 3 | 3 | 23.4 | DataGrid, Form primitives + validation schema |
| **Patient** | `/admin/admin/search` | M | 44 | 1 | 9 | 0 | 1 | 11.1 | DataGrid, Form primitives + validation schema |
| **Dashboard** | `/admin/admin/dashboard` | M | 5 | 3 | 6 | 0 | 1 | 7.7 | DataGrid, Form primitives + validation schema |

Sub-screens: `09-patient-import` (Patient), `11-discharged-patients` (IPD Discharged Patient), `19-appointment-queue` (Smart Hospital & Research Center · Smart Hospital)

## P2 — Billing and OPD consultation

Charge master, single-module and case-based billing, payments, receipts, the OPD consultation workspace.

**Scope:** 3 application screens · 5 sub-screens · **≈ 59 engineer-days** (excluding platform work and design system).

| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |
|---|---|---|---|---|---|---|---|---|---|
| **OPD - Out Patient** | `/admin/patient/search` | L | 84 | 2 | 11 | 4 | 3 | 25.6 | DataGrid, Form primitives + validation schema |
| **Setup › Hospital Charges** | `/admin/charges` | M | 24 | 2 | 7 | 0 | 2 | 11.7 | DataGrid, Form primitives + validation schema |
| **Billing** | `/admin/bill/dashboard` | S | 6 | 0 | 0 | 0 | 1 | 2.8 | Form primitives + validation schema, Money input, charge picker, payment panel, receipt print |

Sub-screens: `01-billing-appointment-module` (Smart Hospital & Research Center · Smart Hospital), `02-billing-opd-module` (OPD Patient · Smart Hospital), `07-billing-bill-dashboard` (Single Module Billing), `08-billing-opd-bill-screen` (OPD Patient · Smart Hospital), `20-opd-patient-view` (OPD Patient · Smart Hospital)

## P3 — Pharmacy and inventory

Pharmacy point of sale with batch/expiry safety, stock, purchase/return, item inventory.

**Scope:** 4 application screens · 2 sub-screens · **≈ 42 engineer-days** (excluding platform work and design system).

| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |
|---|---|---|---|---|---|---|---|---|---|
| **Pharmacy** | `/admin/pharmacy/bill` | M | 35 | 1 | 13 | 0 | 1 | 11.4 | DataGrid, Form primitives + validation schema, Stock/batch picker, expiry guard, POS cart |
| **Inventory** | `/admin/itemstock` | M | 14 | 1 | 10 | 0 | 2 | 10.1 | DataGrid, Form primitives + validation schema |
| **Setup › Inventory** | `/admin/itemcategory` | M | 9 | 2 | 3 | 0 | 1 | 6.5 | DataGrid, Form primitives + validation schema |
| **Setup › Pharmacy** | `/admin/medicinecategory/medicine` | M | 6 | 1 | 2 | 0 | 2 | 6.2 | DataGrid, Form primitives + validation schema, Stock/batch picker, expiry guard, POS cart |

Sub-screens: `12-pharmacy-search` (Medicines Stock), `13-pharmacy-sale-return-bills` (Sale Return Bills)

## P4 — Laboratory, imaging, blood bank and ambulance

Order → specimen → result → report flows with barcode support, imaging worklist, blood bank safety, ambulance dispatch.

**Scope:** 11 application screens · 7 sub-screens · **≈ 132 engineer-days** (excluding platform work and design system).

| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |
|---|---|---|---|---|---|---|---|---|---|
| **Blood Bank** | `/admin/bloodbankstatus/` | L | 90 | 3 | 6 | 0 | 1 | 16.6 | DataGrid, Form primitives + validation schema |
| **Ambulance** | `/admin/vehicle/getcallambulance` | L | 66 | 1 | 17 | 0 | 2 | 16.4 | DataGrid, Form primitives + validation schema |
| **Pathology** | `/admin/pathology/gettestreportbatch` | M | 34 | 1 | 13 | 0 | 1 | 11.3 | DataGrid, Form primitives + validation schema |
| **Radiology** | `/admin/radio/gettestreportbatch` | M | 34 | 1 | 13 | 0 | 1 | 11.3 | DataGrid, Form primitives + validation schema |
| **Setup › ICD-10** | `/admin/icd10` | M | 8 | 1 | 4 | 0 | 2 | 7.3 | DataGrid, Form primitives + validation schema |
| **Setup › Symptoms** | `/admin/symptoms` | M | 8 | 1 | 4 | 0 | 2 | 7.1 | DataGrid, Form primitives + validation schema |
| **Setup › Findings** | `/admin/finding` | M | 8 | 1 | 4 | 0 | 2 | 7.1 | DataGrid, Form primitives + validation schema |
| **Setup › Pathology** | `/admin/pathologycategory/addcategory` | M | 6 | 1 | 2 | 0 | 2 | 6.2 | DataGrid, Form primitives + validation schema |
| **Setup › Radiology** | `/admin/lab/addlab` | M | 6 | 1 | 2 | 0 | 2 | 6.2 | DataGrid, Form primitives + validation schema |
| **Setup › Vitals** | `/admin/vital` | S | 9 | 1 | 4 | 0 | 1 | 5.7 | DataGrid, Form primitives + validation schema |
| **Setup › Blood Bank** | `/admin/bloodbank/products` | S | 7 | 1 | 3 | 0 | 1 | 5.0 | DataGrid, Form primitives + validation schema |

Sub-screens: `03-billing-pathology-module` (Pathology Billing), `04-billing-radiology-module` (Radiology Billing), `05-billing-issue-blood` (Blood Issue Billing), `06-billing-issue-component` (Blood Components Issue Billing), `14-pathology-search` (Pathology Test), `15-radiology-search` (Radiology Test), `16-blood-bank-status-board` (Blood Bank · Smart Hospital)

## P5 — In-patient, ward and operation theatre

Admissions, bed board, nursing documentation, medication administration, OT scheduling, ward handover.

**Scope:** 4 application screens · 0 sub-screens · **≈ 31 engineer-days** (excluding platform work and design system).

| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |
|---|---|---|---|---|---|---|---|---|---|
| **IPD - In Patient** | `/admin/patient/ipdsearch` | L | 75 | 1 | 11 | 0 | 2 | 15.7 | DataGrid, Form primitives + validation schema |
| **Duty Roster** | `/admin/dutyroster/roster_report` | M | 9 | 1 | 8 | 0 | 1 | 6.6 | DataGrid, Form primitives + validation schema |
| **Setup › Operations** | `/admin/operationtheatre/index` | M | 9 | 2 | 3 | 0 | 1 | 6.5 | DataGrid, Form primitives + validation schema |
| **Setup › Bed** | `/admin/setup/bed/status` | S | 5 | 1 | 5 | 0 | 1 | 5.2 | DataGrid, Form primitives + validation schema |

## P6 — Finance, insurance and reporting

Income/expense, TPA/insurance claim pipeline, referral payouts, the report centre and management dashboards.

**Scope:** 23 application screens · 0 sub-screens · **≈ 93 engineer-days** (excluding platform work and design system).

| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |
|---|---|---|---|---|---|---|---|---|---|
| **Referral** | `/admin/referral/payment` | M | 33 | 1 | 7 | 0 | 2 | 11.2 | DataGrid, Form primitives + validation schema |
| **TPA Management** | `/admin/tpamanagement` | M | 17 | 1 | 7 | 0 | 2 | 9.2 | DataGrid, Form primitives + validation schema |
| **Finance › Income** | `/admin/income` | M | 12 | 1 | 8 | 0 | 2 | 8.5 | DataGrid, Form primitives + validation schema |
| **Finance › Expenses** | `/admin/expense` | M | 12 | 1 | 8 | 0 | 2 | 8.5 | DataGrid, Form primitives + validation schema |
| **Setup › Referral** | `/admin/referral/commission` | M | 23 | 1 | 3 | 0 | 1 | 7.9 | DataGrid, Form primitives + validation schema |
| **Setup › Finance** | `/admin/incomehead` | M | 9 | 2 | 3 | 0 | 1 | 6.5 | DataGrid, Form primitives + validation schema |
| **Reports › Finance** | `/admin/report/finance` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Appointment** | `/admin/report/appointment` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › OPD** | `/admin/report/opd` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › IPD** | `/admin/report/ipd` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Pharmacy** | `/admin/report/pharmacy` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema, Stock/batch picker, expiry guard, POS cart |
| **Reports › Pathology** | `/admin/report/pathology` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Radiology** | `/admin/report/radiology` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Blood Bank** | `/admin/report/blood_bank` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Ambulance** | `/admin/report/ambulance` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Birth Death** | `/admin/report/birth_death` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Human Resource** | `/admin/report/human_resource` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › TPA** | `/admin/report/tpa` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Inventory** | `/admin/report/inventory` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Live Consultation** | `/admin/report/live_consultation` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Log** | `/admin/report/log` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › OT** | `/admin/report/ot` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **Reports › Patient** | `/admin/report/patient` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |

## P7 — People, front office and administration

HR (staff, attendance, payroll, leaves), front office registers, birth/death registry, multi-branch console, print templates, settings.

**Scope:** 16 application screens · 2 sub-screens · **≈ 105 engineer-days** (excluding platform work and design system).

| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |
|---|---|---|---|---|---|---|---|---|---|
| **Multi Branch › Overview** | `/admin/multibranch/branch/overview` | L | 8 | 16 | 7 | 0 | 1 | 24.1 | DataGrid, Form primitives + validation schema |
| **Birth & Death Record › Birth Record** | `/admin/birthordeath` | M | 34 | 1 | 11 | 0 | 1 | 10.8 | DataGrid, Form primitives + validation schema |
| **Front Office** | `/admin/visitors` | M | 18 | 1 | 9 | 0 | 2 | 10.4 | DataGrid, Form primitives + validation schema |
| **Birth & Death Record › Death Record** | `/admin/birthordeath/death` | M | 18 | 1 | 10 | 0 | 1 | 8.4 | DataGrid, Form primitives + validation schema |
| **Multi Branch › Settings** | `/admin/multibranch/branch` | M | 11 | 1 | 3 | 0 | 2 | 7.2 | DataGrid, Form primitives + validation schema |
| **Annual Calendar** | `/admin/holiday/index` | M | 13 | 1 | 6 | 0 | 1 | 6.4 | Calendar / roster planner, DataGrid, Form primitives + validation schema |
| **Setup › Front Office** | `/admin/visitorspurpose` | M | 9 | 2 | 3 | 0 | 1 | 6.4 | DataGrid, Form primitives + validation schema |
| **Setup › Human Resource** | `/admin/leavetypes` | M | 6 | 1 | 2 | 0 | 2 | 6.2 | DataGrid, Form primitives + validation schema |
| **Human Resource** | `/admin/staff` | M | 7 | 1 | 7 | 0 | 1 | 6.0 | DataGrid, Form primitives + validation schema |
| **Setup › Custom Fields** | `/admin/customfield` | S | 15 | 0 | 0 | 0 | 1 | 3.8 | Form primitives + validation schema |
| **Setup › Zoom Setting** | `/admin/zoom_conference` | S | 13 | 0 | 0 | 0 | 1 | 3.5 | Form primitives + validation schema |
| **Setup › Appointment** | `/admin/onlineappointment/index` | S | 11 | 0 | 0 | 0 | 1 | 3.5 | Form primitives + validation schema |
| **QR Code Attendance › Settings** | `/admin/qrattendance/setting/index` | S | 11 | 0 | 0 | 0 | 1 | 3.1 | Form primitives + validation schema, QR/Biometric check-in flow |
| **Setup › Print Header Footer** | `/admin/printing` | S | 7 | 0 | 0 | 0 | 1 | 2.8 | Form primitives + validation schema, Print/PDF templates |
| **Multi Branch › Report** | `/admin/multibranch/branch/report` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |
| **QR Code Attendance › Attendance** | `/admin/qrattendance/attendance/index` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema, QR/Biometric check-in flow |

Sub-screens: `17-staff-attendance-register`, `18-payroll` (Payroll)

## P8 — Communication, content, patient portal and website

Notice board, surveys, download centre, certificates and ID cards, Front CMS, telemedicine, patient portal and public site.

**Scope:** 12 application screens · 0 sub-screens · **≈ 64 engineer-days** (excluding platform work and design system).

| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |
|---|---|---|---|---|---|---|---|---|---|
| **Live Consultation › Live Consultation** | `/admin/zoom_conference/consult` | M | 40 | 1 | 9 | 0 | 2 | 12.3 | DataGrid, Form primitives + validation schema |
| **Live Consultation › Live Meeting** | `/admin/zoom_conference/meeting` | M | 26 | 1 | 8 | 0 | 2 | 10.9 | DataGrid, Form primitives + validation schema |
| **Download Center › Upload /Share Content** | `/admin/content/upload` | M | 31 | 1 | 8 | 0 | 2 | 10.7 | DataGrid, Form primitives + validation schema |
| **Certificate › Staff ID Card** | `/admin/generatestaffidcard/` | M | 8 | 1 | 11 | 0 | 1 | 7.0 | DataGrid, Form primitives + validation schema |
| **Download Center › Content Type** | `/admin/contenttype/` | M | 7 | 1 | 3 | 0 | 2 | 6.6 | DataGrid, Form primitives + validation schema |
| **Survey Forms › Survey Forms** | `/admin/survey` | M | 5 | 2 | 5 | 0 | 1 | 6.5 | DataGrid, Form primitives + validation schema |
| **Certificate › Certificate** | `/admin/generatecertificate` | S | 9 | 1 | 6 | 0 | 1 | 6.0 | DataGrid, Form primitives + validation schema |
| **Certificate › Patient ID Card** | `/admin/generatepatientidcard/` | M | 8 | 1 | 7 | 0 | 1 | 6.0 | DataGrid, Form primitives + validation schema |
| **Download Center › Content Share List** | `/admin/content/list` | S | 5 | 1 | 7 | 0 | 1 | 5.7 | DataGrid, Form primitives + validation schema |
| **Survey Forms › My Survey Forms** | `/admin/survey/staff_forms` | S | 5 | 1 | 5 | 0 | 1 | 5.1 | DataGrid, Form primitives + validation schema |
| **Front CMS** | `/admin/front/page` | S | 5 | 1 | 4 | 0 | 1 | 4.9 | DataGrid, Form primitives + validation schema |
| **Messaging** | `/admin/notification` | S | 5 | 0 | 0 | 0 | 1 | 2.6 | Form primitives + validation schema |

## Summary

| Phase | Theme | Screens | Sub-screens | Est. engineer-days |
|---|---|---|---|---|
| P0 | Foundations | 0 | 0 | 0 |
| P1 | Identity, patients, appointments | 3 | 3 | 49 |
| P2 | Billing and OPD consultation | 3 | 5 | 59 |
| P3 | Pharmacy and inventory | 4 | 2 | 42 |
| P4 | Laboratory, imaging, blood bank and ambulance | 11 | 7 | 132 |
| P5 | In-patient, ward and operation theatre | 4 | 0 | 31 |
| P6 | Finance, insurance and reporting | 23 | 0 | 93 |
| P7 | People, front office and administration | 16 | 2 | 105 |
| P8 | Communication, content, patient portal and website | 12 | 0 | 64 |
| | **Total** | **76** | **19** | **575** |

> Add roughly 30–40% on top for platform work (auth, API layer, events, observability, CI/CD, data migration) and 20% for design system, research and usability testing. The roadmap in `04-ROADMAP.md` sequences these phases with that overhead included.

---

_Generated by `tools/plan/build_screen_map.py` from `capture/` — re-run after a new capture to refresh the sizes._
