# Smart Hospital — Wiki & Operator Handbook

> Practical, task-oriented help for the Smart Hospital hospital-management system (`demo.smart-hospital.in`).
> Written from a live exploration of the demo hospital **Smart Hospital & Research Center** — every workflow below was
> performed against the running application. Screenshots are in `docs/assets/screens/`; the screen-by-screen reference
> is in [`FEATURE-CATALOG.md`](FEATURE-CATALOG.md).

---

## 1. Getting started

### 1.1 Signing in

| Portal | URL | Who uses it |
|---|---|---|
| Admin panel | `/site/login` | All hospital staff (9 roles) |
| Patient portal | `/site/userlogin` | Patients (self-service) |
| Public website | `/` | Visitors, prospective patients |

1. Open `/site/login`.
2. Enter **Username** (e-mail address) and **Password**, click **Sign In**.
3. You land on the dashboard for your role. The bell icon, quick-add launcher and global patient search are always available.
4. **Forgot Password?** → `/site/forgotpassword` (patient portal: `/site/ufpassword`).

On the demo build the login page also offers **Quick demo login** buttons that fill the credentials for each role.

| Role | Demo user | Password |
|---|---|---|
| Super Admin | `superadmin@gmail.com` | `password` |
| Admin | `jason@gmail.com` | `password` |
| Doctor | `sonia@gmail.com` | `password` |
| Pharmacist | `harry@gmail.com` | `password` |
| Pathologist | `belinat@gmail.com` | `password` |
| Radiologist | `johnhook@gmail.com` | `password` |
| Accountant | `bradf@gmail.com` | `password` |
| Receptionist | `maria@gmail.com` | `password` |
| Nurse | `april@gmail.com` | `password` |

### 1.2 The application shell

* **Sidebar** — every module, grouped into five sections: *Core Operations*, *Clinical*, *Administration*, *Tools & Content*, *Reports & Setup*. Type in **Filter Menu** to find a screen by name.
* **Global patient search** — the "Search By Patient Name" box in the header searches the whole patient index from any screen and opens the patient profile.
* **Quick Add** — floating launcher with *Add Patient*, *New OPD Patient*, *New IPD Patient*, *New Appointment*, *New Bill*.
* **Bed status** — live bed/ward occupancy modal.
* **Notifications** — bell menu with module alerts (OPD/IPD/pathology/radiology/pharmacy/appointment), notices, chat and calendar/to-do.
* **Language switcher** and **user menu** (profile, password, logout).

### 1.3 The dashboard

The dashboard is role-aware. For a Super Admin it shows:

* KPI tiles — *Total revenue MTD*, *Bed occupancy*, *Today's appointments*, *Outstanding bills*, *Medicines stock*, *Blood bank inventory*.
* *Yearly income & expense* — 12-month trend (collected vs spent).
* *Monthly income overview* — donut of income share by module (OPD, IPD, Pharmacy, Pathology, Radiology, Blood Bank, Ambulance, Income).
* *Recent activity* — tail of the audit log (bills posted, patients registered…) with user, module, amount and timestamp.
* *Staff attendance* — role-wise present/absent summary for the day.
* *Income by module* — table with this-month vs last-month comparison.

![Dashboard](assets/screens/001-dashboard.jpg)

---

## 2. Initial configuration (do this once, as Super Admin)

Recommended order — later modules depend on earlier masters:

1. **Settings** (`/schsettings`) — hospital name, logo, address, contact, currency, date format, time zone, session timeout.
2. **Hospital Charges** (`/admin/charges`) — the charge catalogue used by billing, OPD and IPD (consultation, procedure, room, investigation, etc.).
3. **Bed** (`/admin/setup/bed/status`) — wards, bed groups and individual beds; drives admission and the bed-status board.
4. **Print Header Footer** (`/admin/printing`) — per-module header/footer used on bills, reports, prescriptions, certificates.
5. **Finance** (`/admin/incomehead`) — income and expense heads.
6. **Front Office** (`/admin/visitorspurpose`) — visitor purposes, call log types, complaint types.
7. **Operations** (`/admin/operationtheatre/index`) — operation theatre master.
8. **Pharmacy** (`/admin/medicinecategory/medicine`) — medicine categories, units, suppliers and medicines.
9. **Pathology** (`/admin/pathologycategory/addcategory`) — test categories and tests (with parameters, ranges, units).
10. **Radiology** (`/admin/lab/addlab`) — imaging categories and studies.
11. **Blood Bank** (`/admin/bloodbank/products`) — components, bag types and stock.
12. **Symptoms / Findings / Vitals / ICD-10** — the clinical libraries used by OPD and IPD.
13. **Finance → Referral commission**, **Human Resource → Leave types**, **Appointment → slots / online appointment**, **Inventory → item categories**, **Custom Fields**.
14. **Users & roles**: create staff (HR → Add Staff) and assign the role that decides the menu they see.
15. **Notification settings** — per-event delivery over **e-mail, SMS, WhatsApp and mobile-app push** (*System Settings → Notification Setting*), plus the *SMS Setting* and *Email Setting* gateway credentials. See §6.2.
16. **Two-Factor Authentication** — 2FA setup for privileged staff (§9.2) using Google Authenticator.
17. **Zoom setting** (`/admin/zoom_conference`) if you will use teleconsultation.
18. **Front CMS** (`/admin/front/page`) to publish the public website.

> **Tip** — Most masters are ordinary list screens: DataTables search, an **Add** button opening a modal, row actions for edit/delete, and CSV/print export.

---

## 3. Front-desk workflows

### 3.1 Register a patient

**Patient → Patient List** (`/admin/admin/search`) → **Add New Patient** (or Quick Add → *Add Patient*).

Capture at minimum: name, guardian name, gender, date of birth/age, mobile, e-mail, address, blood group, marital status, photo and (optionally) TPA/insurance details. The system assigns the patient ID (MR number) that every other module uses.

* **Import Patient** — bulk import from CSV.
* **Disabled Patient List** — archive/restore patients instead of deleting.
* **Delete Selected** — bulk delete with the row checkboxes.

![Patient list](assets/screens/002-patient.jpg)

### 3.2 Book an appointment

**Appointment** (`/admin/appointment/index`) with tabs **Today**, **Upcoming**, **Old**.

1. **Add Appointment** → choose patient (or *New Patient*), doctor, date, slot, priority and message.
2. Slots come from **Setup → Appointment** (`/admin/onlineappointment/index`); the *Doctor Wise* view shows a doctor's day.
3. **Queue** view prints/serves tokens for walk-ins.
4. Online bookings made from the public site arrive in **Setup → Appointment → Online Appointment** for approval.
5. Change status from the row (booked → confirmed → checked-in → consulted → cancelled).

![Appointment](assets/screens/004-appointment.jpg)

### 3.3 OPD visit (out-patient)

**OPD – Out Patient** (`/admin/patient/search`) with tabs **Today OPD**, **Upcoming OPD**, **Old OPD**, **Patient View**.

1. Select a patient or **Add Patient**, then **New Visit**.
2. In the visit form record: appointment/date, consultant, symptoms (from the symptom library), ICD-10 diagnosis, findings, vitals, history, prescription rows, investigation orders and charges.
3. **Save & Print** produces the prescription; **Save** returns to the list.
4. Investigations ordered here appear in Pathology/Radiology billing and reporting queues.
5. **Discharge** an OPD patient when the episode is complete (vendor help: *How to Discharge patient from OPD*).

![OPD](assets/screens/005-opd-out-patient.jpg)

### 3.4 IPD admission → discharge (in-patient)

**IPD – In Patient** (`/admin/patient/ipdsearch`).

1. **New IPD Patient** → patient, consultant, ward/bed (from the bed master), admission date, TPA/insurance, guardian and case details.
2. Inside the case you get tabs for **Visit/Overview**, **Vitals** (with BMI), **Prescription**, **Lab Investigation**, **Radiology**, **Pharmacy**, **Billing**, **Timeline**, and specialty blocks such as previous obstetric / postnatal / antenatal history.
3. Nursing staff record vitals and notes from the same case (their role restricts them to ward work).
4. **Bed transfer** and **discharge summary** are available from the case; discharge frees the bed and unlocks the final IPD bill and certificates.

![IPD](assets/screens/006-ipd-in-patient.jpg)

### 3.5 Billing & payments

**Billing** (`/admin/bill/dashboard`).

* **Single Module Billing** — bill one department (OPD, pharmacy, pathology, radiology, blood bank, ambulance…).
* **OPD/IPD billing through Case ID** — pull all charges booked against a case.
* Take full or **part payment**, choose the payment mode (cash, cheque, card, UPI/bank transfer, TPA), apply discount, then **Print** the receipt or **PDF** it.
* Outstanding amounts roll up into the dashboard tile *Outstanding bills* and the *Unpaid / Overdue* split.

![Billing](assets/screens/003-billing.jpg)

### 3.6 Visitors, calls, post and complaints

**Front Office** (`/admin/visitors`) — four registers:

* **Visitor pass** — purpose, name, "visit to" (IPD/OPD/staff), phone, ID proof, in/out time.
* **Phone Call Log** — incoming/outgoing, caller, related patient, follow-up date.
* **Postal** — dispatch and receive register.
* **Complain** — complaint type, source, complainant, date, action taken, assigned to.

Purpose lists and call/complaint types are configured in **Setup → Front Office** (`/admin/visitorspurpose`).

---

## 4. Clinical services

### 4.1 Pharmacy

**Pharmacy** (`/admin/pharmacy/bill`) is the point of sale *and* store control.

* Add medicines in **Setup → Pharmacy** first (category, unit, supplier, batch, MRP, sale price, GST, reorder level).
* **Bill** — search a medicine, pick the batch (expiry shown), quantity, discount; the system deducts stock and posts the income to the dashboard.
* **Stock / Bad stock** — receive purchase, transfer between store and counter, mark expiry/bad stock (vendor help: *How to add Medicine Stock / Bad Stock*).
* **Import Medicines** — CSV import for large catalogues.
* Returns and refunds are handled from the bill list.

### 4.2 Pathology (laboratory)

**Pathology** (`/admin/pathology/gettestreportbatch`).

1. Order tests against a patient (or accept an OPD/IPD order).
2. **Sample collection** → **result entry** per parameter (value, unit, normal range) → **approve/verify**.
3. **Generate report** — single or **batch** (many patients at once), with configured header/footer and print/PDF output.
4. Payment for tests is posted to billing; the *Pathology Bill* screen tracks it.

### 4.3 Radiology (imaging)

**Radiology** (`/admin/radio/gettestreportbatch`) — same order → schedule → perform → report flow, with findings/impression text and attachments. Reports print in batch like pathology.

### 4.4 Blood bank

**Blood Bank** (`/admin/bloodbankstatus/`).

* **Stock** — component-wise (Whole blood, PRBC, FFP, platelets) and group-wise (A+, B+, O-, AB+ …) with bag numbers and expiry.
* **Donor registry** — donor details, screening, donation history.
* **Issue** — issue to a patient (with cross-match), record return or discard.
* Dashboard tile and alerts keep an eye on low stock.

### 4.5 Ambulance

**Ambulance** (`/admin/vehicle/getcallambulance`) — vehicle and driver master, call register (caller, patient, pickup address, date/time), charge for the trip and status (pending → dispatched → completed).

---

## 5. Administration & human resources

### 5.1 Staff and HR

**Human Resource** (`/admin/staff`) — staff directory with Staff ID, name, role, department, designation, mobile, photo.

* **Add Staff** — personal and professional details, role (drives permissions), login credentials, payroll and leave policy.
* **Card View / List View** toggle.
* From a staff record: **Staff Attendance**, **Payroll**, **Leaves**.

### 5.2 QR-code attendance

**QR Code Attendance → Attendance** (`/admin/qrattendance/attendance/index`) shows the monthly register (present/absent/half-day/late, in and out time).

* **Settings** (`/admin/qrattendance/setting/index`) configures the QR/check-in window and rules; staff scan the hospital QR to mark attendance.
* Attendance feeds the dashboard *Staff attendance* panel and HR reports.

### 5.3 Duty roster and calendar

* **Duty Roster** (`/admin/dutyroster/roster_report`) — assign shifts (morning/evening/night) per staff and department, per day; export/print the roster.
* **Annual Calendar** (`/admin/holiday/index`) — holidays, events and (per vendor help) to-do items.

### 5.4 Birth & death register

**Birth Record** (`/admin/birthordeath`) and **Death Record** (`/admin/birthordeath/death`) capture the statutory fields (child/parent details, hospital, doctor, certificate number) and print certificates. Both feed the *Birth Death* report.

### 5.5 Referral commissions

**Referral** (`/admin/referral/payment`) — referral doctor/agent master, commission percentage per service (Setup → Referral), and the ledger of commission payable/paid per referred case.

### 5.6 TPA / insurance

**TPA Management** (`/admin/tpamanagement`) — insurance companies, TPA master, patient policies and claim status tracking; TPA payments appear in the *TPA* report and in billing as a payment mode.

### 5.7 Finance ledger

* **Income** (`/admin/income`) and **Expenses** (`/admin/expense`) — head-wise entries with date, amount, invoice/reference, remark and attachment.
* Heads are maintained in **Setup → Finance** (`/admin/incomehead`).
* Both feed the *Finance* report, the dashboard trend chart and *Income by module*.

### 5.8 Multi-branch

**Multi Branch** has three screens:

* **Overview** (`/admin/multibranch/branch/overview`) — group KPIs per branch (patients, collections, beds) side by side.
* **Report** (`/admin/multibranch/branch/report`) — comparative reporting across branches.
* **Settings** (`/admin/multibranch/branch`) — the branch master (name, code, address, contact, admin) plus the branch switcher in the header.

![Multi-branch overview](assets/screens/015-multi-branch-overview.jpg)

---

## 6. Communication, content and documents

### 6.1 Notice board / messaging

**Messaging** (`/admin/notification`) — publish notices to selected audiences (roles, staff, patients, branch) with title, message, date, attachment and publish/expiry window. Recipients see them in the bell menu.

### 6.2 Notifications, SMS, e-mail and WhatsApp

Notifications are **event driven**. For each event (for example *OPD Patient Registration*, *IPD Patient Discharge*,
*Appointment Approved*, *Login Credentials*) you choose which channels deliver it:

| Channel | Where it is configured | Notes |
|---|---|---|
| **System / in-app** | System Settings → Notification Setting | Bell menu + notice board |
| **E-mail** | Email Setting (SMTP credentials) | Used for credentials and reports |
| **SMS** | SMS Setting (gateway credentials) | Charged per message by the gateway |
| **WhatsApp** | WhatsApp Messaging → Meta (Cloud API) **or** Twilio | One provider at a time; the template configured for the event is used |
| **Mobile app push** | Android app integration | Free channel for installed patients/staff |

> **WhatsApp setup** — open *WhatsApp Messaging*, choose the **Meta** tab (official WhatsApp Business Cloud API) or the
> **Twilio** tab (sandbox or approved sender), enter the credentials, enable exactly one provider, then switch WhatsApp on
> per event on the Notification Setting page. The same event template that already goes out by e-mail/SMS is reused.
> Mirror: `docs/help-library/whatsapp-messaging/`.

**Patient credentials** can be sent from the patient record over any enabled channel (e-mail/SMS/WhatsApp/push), which is
how patients get access to the patient panel (see §8).

### 6.3 Survey forms

**Survey Forms** (`/admin/survey`) — build questionnaires (question types: text, textarea, radio, checkbox, dropdown, date, rating), publish them to selected roles/departments and read responses. **My Survey Forms** (`/admin/survey/staff_forms`) is the staff-facing list of forms assigned to the signed-in user.

### 6.4 Download center

**Download Center** (`/admin/content/upload`, `/admin/content/list`, `/admin/contenttype/`) — content types, upload/share files (reports, circulars, policies) with audience and download counters.

### 6.5 Certificates and ID cards

* **Certificate** (`/admin/generatecertificate`) — choose module (OPD/IPD), discharged patients and a certificate template; generate **single or multiple** at once and print.
* **Patient ID Card** (`/admin/generatepatientidcard/`) and **Staff ID Card** (`/admin/generatestaffidcard/`) — template-based cards with photo, ID and validity.

### 6.6 Inventory

**Inventory** (`/admin/itemstock`) — item categories (Setup → Inventory), suppliers, item master, issue/return to departments, stock ledger and reorder alerts; *Inventory* report shows consumption.

### 6.7 Front CMS (public website)

**Front CMS** (`/admin/front/page`) manages the public site: pages, banners/sliders, news & events, gallery, departments, doctors, contact and SEO metadata. Content published here appears on the hospital website and in the "What's new" block of the login page.

### 6.8 Telemedicine

* **Live Consultation** (`/admin/zoom_conference/consult`) — schedule a Zoom teleconsultation for a patient, share the join link, start/end the session; the call is logged for reporting.
* **Live Meeting** (`/admin/zoom_conference/meeting`) — internal staff meetings with participants and schedule.
* Configure Zoom keys/secret in **Setup → Zoom Setting** (`/admin/zoom_conference`).

---

## 7. Reports

**Reports** menu (17 report screens in the admin UI). Every report shares the same pattern:
**date range + module-specific filters → Search → results table → export/print**.

> The vendor help library documents **44 report articles** (per-report how-tos such as *Daily Transaction Report*,
> *Stock Report*, *Balance Amount Report*, *Pathology/Radiology Balance Report*). They are mirrored under
> `docs/help-library/reports/` and indexed in `docs/HELP-LIBRARY.md`.

| Report | What you get |
|---|---|
| Finance | Collections, income vs expense, payment-mode wise summary |
| Appointment | Bookings by period, doctor, status |
| OPD | Visit counts, diagnosis mix, doctor-wise load |
| IPD | Admissions, discharges, bed-days, ward-wise census |
| Pharmacy | Sales, stock movement, expiry/bad stock, profit |
| Pathology | Test-wise counts, revenue, pending vs reported |
| Radiology | Study counts and revenue |
| Blood Bank | Donations, issues, component stock |
| Ambulance | Calls, trips, revenue |
| Birth Death | Birth and death register extracts |
| Human Resource | Staff list, attendance, leaves, payroll |
| TPA | Claim-wise and company-wise settlement status |
| Inventory | Item consumption and stock valuation |
| Live Consultation | Teleconsultation log and duration |
| OT | Operation theatre utilisation and procedures |
| Patient | Patient demographics and registration trend |
| Log | System audit trail (user, module, action, record, time) |

![Reports — Finance](assets/screens/040-reports-finance.jpg)

---

## 8. Patient portal & public website

* **Patient portal** (`/site/userlogin`) — patients sign in with the credentials sent from the patient record and get their own **dashboard** (counts per module plus charts of medical history, findings and symptoms). Sections available to the patient:
  * **My Appointments** — view and **book** an appointment (date, specialist, doctor, shift, slot, priority, message, live-consultation option).
  * **OPD** — visits list; open a visit for overview, visits, charges, payment, lab investigations, timeline, medication, operation theatre and live consultation.
  * **IPD** — overview, nurse notes, consultant register, lab investigations, timeline, prescription, charges, payment, treatment history, medication, operation theatre, live consultation and bed history.
  * **Pharmacy / Pathology / Radiology / Blood Bank / Ambulance** — bill and payment history per module, printable bills and payment receipts.
  * **Live Consultation** — join the Zoom teleconsultation booked from appointment, OPD or IPD.
  * Reference: `docs/help-library/patient-panel/`.
* **Public website** — driven by Front CMS: home page with departments, doctors, services, health packages, news, gallery, contact and an **online appointment** form. Online bookings land in the admin *Online Appointment* queue.
* **New patient registration** on the public site creates a patient record that appears in the admin Patient List with the same MR number.

---

## 9. Roles, permissions and security

### 9.1 Roles and the audit trail

* Nine staff roles ship by default; each role maps to a permission set that controls the sidebar and every screen.
* The signed-in role is shown in the header (e.g. *Super ADMIN*); switching role requires re-login.
* Every form carries a CSRF token; passwords are hashed; sessions expire per the configured timeout.
* The **Log** report and dashboard *Recent activity* give an audit trail of who did what and when.
* The **Android app** (vendor addon) provides the same staff/patient flows on mobile with push notifications; see
  `docs/help-library/changelog/` and backlog E13 for mobile coverage.
* Vendor documentation covers SSL enablement, LAN deployment, and moving the installation between servers.

---

### 9.2 Two-factor authentication

The product ships a **Two Factor Authentication** module (Google Authenticator / TOTP):

1. Sign in as Super Admin (or the staff member) and open **Two Factor Authentication → Setup 2FA**.
2. Install **Google Authenticator** (or any TOTP app) on the mobile device.
3. Scan the QR code (or manually enter the key shown in the module) and confirm the 6-digit code to finish enrolment.
4. From then on, sign-in asks for the current code in addition to the password.
5. To reset a lost device, delete the 2FA account for that user from the same module and re-enrol.
6. If automatic enrolment fails, the key for superadmin/staff can be configured manually (vendor article).

> Mirror: `docs/help-library/two-factor-authentication/`.
> **Recommendation for DiziHospital:** enforce 2FA for every role that can reach billing or clinical records (backlog E4).

## 10. Troubleshooting & FAQ

| Symptom | What to check |
|---|---|
| Cannot log in / login URL missing | Correct portal (`/site/login` vs `/site/userlogin`); see vendor article *Unable to Login or Missing Login URL*. |
| A menu item is missing for a user | Their **role** does not include that permission — adjust the role/staff record. |
| Blank page or 500 error | `ONLY_FULL_GROUP_BY` SQL mode on the MySQL server (vendor article), or missing PHP extensions (`mysqli`, `mbstring`, `zip`, `curl`). |
| "404 / Page not found" after installation | `mod_rewrite` disabled or `.htaccess` missing (vendor article *404 Or Page Not Found Error In Installation*). |
| Reports return no rows | Date range, branch filter and module status filters are cumulative — widen the range first. |
| Stock not decreasing in pharmacy | The bill must be **paid/saved**, not merely drafted; bad/expired stock uses the *Bad Stock* entry. |
| Lab report not printable | Results must be **approved/verified** before the report can be generated. |
| Patient portal shows no investigations | Reports are visible to the patient only after they are released/approved. |
| Slow pages | Enable caching/CDN, check server resources; PHP `max_execution_time` ≥ 60s is recommended by the vendor. |
| Need a field that does not exist | Add it non-invasively through **Setup → Custom Fields**. |

**Frequently asked (vendor articles, for depth):** multi-hospital usage, running on a local LAN without internet, moving to a new server, enabling SSL, special characters, adding calendar events and to-dos, chat contacts.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **OPD** | Out-Patient Department — walk-in/consultation visits |
| **IPD** | In-Patient Department — admitted patients |
| **MR / Patient ID** | Master record number identifying a patient across modules |
| **Case ID** | The episode identifier linking OPD/IPD visits, orders and bills |
| **TPA** | Third-Party Administrator handling insurance claims |
| **ICD-10** | International Classification of Diseases, 10th revision — diagnosis coding |
| **Charge master** | Catalogue of billable items and prices |
| **Bad stock** | Expired/damaged medicine stock written off |
| **Roster** | Duty/shift plan per staff member |
| **Vitals** | Temperature, pulse, blood pressure, respiration, SpO₂, BMI |
| **Sample collection** | Pathology step between ordering a test and entering results |
| **Batch** | A specific lot of a medicine identified by batch number and expiry |
| **MRP / Sale price** | Maximum retail price / the price charged to the patient |
| **QR attendance** | Staff attendance marked by scanning a QR code |
