#!/usr/bin/env python3
"""
Build the product documentation from the captured evidence (v2 - curated layout).

Inputs (produced by the capture workflows):
  capture/nav.json, capture/index.json, capture/pages/*, capture/forms/*,
  capture/detail/*, capture/roles/*, capture/frontsite/*

Outputs:
  docs/FEATURE-CATALOG.md       screen-by-screen, form-by-form feature catalogue
  docs/assets/screens/*.jpg     curated screenshots used by the docs and the PDF
  docs/build/catalog.json       machine readable summary consumed by build_html.py
"""
import json
import os
import re
import shutil
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CAP = os.path.join(ROOT, 'capture')
DOCS = os.path.join(ROOT, 'docs')
ASSETS = os.path.join(DOCS, 'assets', 'screens')
BUILD = os.path.join(DOCS, 'build')

MAX_FIELDS_PER_FORM = 22

MODULES = [
    {
        'section': 'CORE OPERATIONS', 'slug': 'core-operations', 'name': 'Core Operations',
        'purpose': 'Day-to-day desk work: the dashboard, the master patient index, billing, appointments and the OPD/IPD clinical desks.',
        'ids': ['001-dashboard', '002-patient', '003-billing', '004-appointment', '005-opd-out-patient', '006-ipd-in-patient'],
        'highlights': [
            'One dashboard aggregating revenue, bed occupancy, appointments, stock, blood bank and per-module income share.',
            'A single patient master index shared by OPD, IPD, billing, pharmacy, pathology and radiology.',
            'Appointment desk with doctor-wise slots, a queue/token view and online-appointment intake.',
            'OPD/IPD desks expose the whole clinical record: vitals, symptoms, ICD-10 diagnosis, prescription, lab and radiology orders and a timeline.',
        ],
    },
    {
        'section': 'CLINICAL', 'slug': 'clinical', 'name': 'Clinical & Ancillary Services',
        'purpose': 'The departments that raise bills and reports against a patient: pharmacy, laboratory, imaging, blood bank, ambulance and front office.',
        'ids': ['007-pharmacy', '008-pathology', '009-radiology', '010-blood-bank', '011-ambulance', '012-front-office'],
        'highlights': [
            'Pharmacy store and sale workflow with batch, expiry, GST, discount and stock movement.',
            'Pathology and radiology: order → sample/procedure → result entry → report generation → print/PDF, single or in batch.',
            'Blood-bank stock by component and group, donor registry and issue to patient.',
            'Ambulance call register with vehicle/driver assignment and trip charges.',
            'Front office covers visitors, phone call logs, postal dispatch and complaints.',
        ],
    },
    {
        'section': 'ADMINISTRATION', 'slug': 'administration', 'name': 'Administration & HR',
        'purpose': 'Back office: legal registers, multi-branch operation, staff HR, attendance, rosters, referrals, insurance/TPA and the finance ledger.',
        'ids': ['013-birth-death-record-birth-record', '014-birth-death-record-death-record', '015-multi-branch-overview',
                '016-multi-branch-report', '017-multi-branch-settings', '018-human-resource', '019-qr-code-attendance-attendance',
                '020-qr-code-attendance-settings', '021-duty-roster', '022-annual-calendar', '023-referral',
                '024-tpa-management', '025-finance-income', '026-finance-expenses'],
        'highlights': [
            'Birth and death registers with the fields needed for statutory certificates.',
            'Multi-branch console: consolidated overview, branch comparison report and branch master with header switching.',
            'HR: staff directory, roles, payroll, leaves, QR-code attendance and duty roster report.',
            'Referral commission ledger and TPA/insurance register.',
            'Income and expense ledgers that feed the finance reports and the dashboard.',
        ],
    },
    {
        'section': 'TOOLS & CONTENT', 'slug': 'tools-content', 'name': 'Communication, Content & Certificates',
        'purpose': 'Everything that talks to people or produces a document: surveys, notice board, downloads, inventory, ID cards, certificates, the public website CMS and telemedicine.',
        'ids': ['027-survey-forms-survey-forms', '028-survey-forms-my-survey-forms', '029-messaging', '030-inventory',
                '031-download-center-upload-share-content', '032-download-center-content-share-list',
                '033-download-center-content-type', '034-certificate-certificate', '035-certificate-patient-id-card',
                '036-certificate-staff-id-card', '037-front-cms', '038-live-consultation-live-consultation',
                '039-live-consultation-live-meeting'],
        'highlights': [
            'Survey/questionnaire builder with per-role assignment and response collection.',
            'Notice board / messaging with audience targeting and attachments.',
            'Download center for sharing documents with staff, patients and the public site.',
            'Certificate generator plus patient and staff ID cards driven by templates.',
            'Front CMS that drives the public hospital website (pages, banners, news, gallery, contact).',
            'Zoom-based live consultation and internal live meetings.',
        ],
    },
    {
        'section': 'REPORTS & SETUP', 'slug': 'reports-setup', 'name': 'Reports, Masters & Configuration',
        'purpose': 'The 17 management reports plus the master data and lookups that make the rest of the application work.',
        'ids': ['040-reports-finance', '041-reports-appointment', '042-reports-opd', '043-reports-ipd', '044-reports-pharmacy',
                '045-reports-pathology', '046-reports-radiology', '047-reports-blood-bank', '048-reports-ambulance',
                '049-reports-birth-death', '050-reports-human-resource', '051-reports-tpa', '052-reports-inventory',
                '053-reports-live-consultation', '054-reports-log', '055-reports-ot', '056-reports-patient',
                '057-setup-hospital-charges', '058-setup-bed', '059-setup-print-header-footer', '060-setup-front-office',
                '061-setup-operations', '062-setup-pharmacy', '063-setup-pathology', '064-setup-radiology',
                '065-setup-blood-bank', '066-setup-symptoms', '067-setup-icd-10', '068-setup-findings', '069-setup-vitals',
                '070-setup-zoom-setting', '071-setup-finance', '072-setup-human-resource', '073-setup-referral',
                '074-setup-appointment', '075-setup-inventory', '076-setup-custom-fields'],
        'highlights': [
            'Report centre covering finance, appointment, OPD, IPD, pharmacy, pathology, radiology, blood bank, ambulance, birth/death, HR, TPA, inventory, live consultation, operation theatre, patient and the system audit log.',
            'Masters for charges, beds, print headers, front-office purposes, operation theatre, pharmacy, pathology, radiology, blood bank, symptoms, ICD-10, findings, vitals, finance heads, leave types, referral commission, appointment slots, inventory items and custom fields.',
        ],
    },
]

PAGE_NOTES = {
    '001-dashboard': 'Role-aware landing page: KPI tiles (revenue MTD, bed occupancy, appointments, outstanding bills, medicine stock, blood-bank stock), a 12-month income-vs-expense trend, a module-wise income donut, the latest activity feed, staff attendance and module income table.',
    '002-patient': 'Master patient index. Search, add or import patients, view disabled patients, open the full patient profile and jump straight into a bill.',
    '003-billing': 'Billing workbench: single-module billing and OPD/IPD billing through a case ID, part payments, payment modes, discounting and printable receipts.',
    '004-appointment': 'Appointment desk with Today / Upcoming / Old tabs, doctor-wise and queue views, slot validation and online-appointment handling.',
    '005-opd-out-patient': 'OPD desk: Today / Upcoming / Old visit lists plus the "New Visit" workflow (symptoms, ICD-10, prescription, investigations, charges) and the patient view.',
    '006-ipd-in-patient': 'IPD desk: admission, bed/ward allocation, consultant assignment, daily notes, medication, investigations, charges and discharge.',
    '007-pharmacy': 'Pharmacy point of sale: batch-wise issue, GST, discounts, stock deduction and printable bill.',
    '008-pathology': 'Laboratory worklist: order intake, sample collection, result entry/approval and single or batch report generation.',
    '009-radiology': 'Imaging worklist: order intake, scheduling, findings entry and batch report generation.',
    '010-blood-bank': 'Blood bank: component stock by group, donor registry, issue to patient and status board.',
    '011-ambulance': 'Ambulance call register with vehicle/driver, trip details and charges.',
    '012-front-office': 'Reception toolkit: visitor pass, phone call log, postal register and complaints.',
    '015-multi-branch-overview': 'Group console comparing branches on patients, collections and occupancy.',
    '016-multi-branch-report': 'Cross-branch comparative reporting with date range and module filters.',
    '017-multi-branch-settings': 'Branch master: create/edit branches, assign the branch admin and switch the active branch.',
    '018-human-resource': 'Staff directory with role, designation and department, plus entry points to attendance, payroll and leaves.',
    '019-qr-code-attendance-attendance': 'Scan-based staff attendance register with a monthly view and in/out times.',
    '020-qr-code-attendance-settings': 'QR attendance rules: check-in window, working hours and device/QR configuration.',
    '021-duty-roster': 'Shift roster per staff/department with print and export.',
    '022-annual-calendar': 'Holiday and event calendar, plus to-dos per the vendor help articles.',
    '023-referral': 'Referral commission ledger: payouts against referred cases with filters by referral person and period.',
    '024-tpa-management': 'Insurance/TPA register: companies, policies and claim status per patient.',
    '025-finance-income': 'Income ledger: head-wise entries that feed the finance reports and the dashboard trend.',
    '026-finance-expenses': 'Expense ledger: head-wise entries with reference, invoice and remarks.',
    '027-survey-forms-survey-forms': 'Survey builder: create questionnaires, assign them to roles/departments and read responses.',
    '028-survey-forms-my-survey-forms': 'The signed-in staff member\'s own survey forms.',
    '029-messaging': 'Notice board for staff/patients with audience targeting and attachments.',
    '030-inventory': 'Item stock control: categories, suppliers, issue and return, stock ledger and reorder levels.',
    '031-download-center-upload-share-content': 'Upload/share documents with staff, patients or the public site, with content type and audience.',
    '032-download-center-content-share-list': 'Everything shared so far, with filters and download counters.',
    '033-download-center-content-type': 'Content type master used when uploading shared content.',
    '034-certificate-certificate': 'Certificate generator: pick module and discharged patients, choose a template and generate single or bulk certificates.',
    '035-certificate-patient-id-card': 'Patient ID-card generation from templates with photo and MR number.',
    '036-certificate-staff-id-card': 'Staff ID-card generation from templates.',
    '037-front-cms': 'Website content management: pages, banners, news, gallery, contact and SEO for the public site.',
    '038-live-consultation-live-consultation': 'Zoom teleconsultation: schedule a session for a patient, share the link, start/end and log the call.',
    '039-live-consultation-live-meeting': 'Internal staff video meetings with scheduling and participants.',
    '057-setup-hospital-charges': 'The charge catalogue (consultation, procedures, room, investigations, services) reused by billing, OPD and IPD.',
    '058-setup-bed': 'Bed/ward master with live occupancy status board.',
    '059-setup-print-header-footer': 'Per-module print header/footer designer used by every printed bill, report, prescription, certificate and ID card.',
    '062-setup-pharmacy': 'Medicine categories, units, suppliers and the medicine master (batch, MRP, sale price, GST, reorder level).',
    '063-setup-pathology': 'Pathology categories and tests with parameters, units and normal ranges.',
    '064-setup-radiology': 'Radiology categories and studies.',
    '065-setup-blood-bank': 'Blood-bank components, bag types and product stock.',
    '066-setup-symptoms': 'Symptom library used by OPD/IPD clinical entry.',
    '067-setup-icd-10': 'ICD-10 code library used for diagnosis entry.',
    '068-setup-findings': 'Finding library used by clinical encounters.',
    '069-setup-vitals': 'Vital-sign master (temperature, pulse, BP, respiration, SpO2, BMI) for IPD/OPD charts.',
    '070-setup-zoom-setting': 'Zoom API keys/secret so live consultation and live meeting work.',
    '071-setup-finance': 'Income and expense heads used by the finance ledger and reports.',
    '072-setup-human-resource': 'Leave types and standing HR configuration.',
    '073-setup-referral': 'Referral commission percentages per referral person/service.',
    '074-setup-appointment': 'Appointment slots and the online-appointment intake queue.',
    '075-setup-inventory': 'Item categories and the item master for inventory.',
    '076-setup-custom-fields': 'Add hospital-specific fields to core entities without changing the schema.',
}

IGNORE_FORM_ACTIONS = ('admin/search', 'updatepurchasecode', 'updateaddon', 'branch/switch')
IGNORE_TRIGGERS = ('switch branch',)
DIALOG_KEYWORDS = re.compile(r'\b(add|new|import|edit|book|generate|register|bill|visit|consult|upload|create)\b', re.I)

ROLE_DESCRIPTIONS = {
    'superadmin': ('Super Admin', 'unrestricted access to every module, master and setting, plus the multi-branch console and vendor licence screens'),
    'admin': ('Admin', 'hospital administrator: clinical, billing, HR, finance and reporting without the vendor/licence screens'),
    'doctor': ('Doctor', 'clinical workspace: appointments, OPD/IPD patients, prescriptions, investigations and own-patient reports'),
    'pharmacist': ('Pharmacist', 'pharmacy only: sale/issue, stock, batch and expiry handling, pharmacy reports'),
    'pathologist': ('Pathologist', 'laboratory only: test orders, sample collection, result entry and report generation'),
    'radiologist': ('Radiologist', 'imaging only: study orders, scheduling and reporting'),
    'accountant': ('Accountant', 'finance: billing, income/expense, payroll and financial reports'),
    'receptionist': ('Receptionist', 'front desk: patient registration, appointments, OPD visits, visitors and billing intake'),
    'nurse': ('Nurse', 'ward work: IPD patients, vitals, nursing notes, duty roster and bed status'),
}

DETAIL_TITLES = {
    'ipd-profile': 'IPD patient case — every tab of an admitted patient',
    'opd-profile-2': 'OPD patient record — every tab of an out-patient',
    'opd-profile': 'OPD patient record',
    'patient-profile': 'Patient master record',
    'billing-screen': 'Single-module billing screens (OPD / appointment)',
    'ipd': 'IPD patient case (admitted patient)',
    'opd': 'OPD patient case',
    'appointment': 'Appointment record',
    'staff': 'Staff profile',
    'patient-master': 'Patient master record',
    'billing': 'Bill / invoice detail',
    'pharmacy': 'Pharmacy bill detail',
    'pathology': 'Pathology report detail',
    'bloodbank': 'Blood bank record',
    'ambulance': 'Ambulance call record',
}


def jload(p, default=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default


def slugify(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', (s or '').lower())).strip('-')


def copy_shot(src, name):
    if not src or not os.path.exists(src):
        return None
    os.makedirs(ASSETS, exist_ok=True)
    dst = os.path.join(ASSETS, name)
    try:
        if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):
            shutil.copy2(src, dst)
    except Exception:
        return None
    return name


def clean_forms(profile):
    out = []
    for f in profile.get('forms', []) or []:
        action = (f.get('action') or '').lower()
        if any(k in action for k in IGNORE_FORM_ACTIONS) or not f.get('fields'):
            continue
        out.append(f)
    return out


def signature(form):
    return tuple(sorted((f.get('name') or f.get('label') or '') for f in form.get('fields', [])))


def field_line(field):
    label = re.sub(r'\s+', ' ', (field.get('label') or field.get('name') or 'field').strip())
    bits = [field.get('type') or 'text']
    if field.get('required'):
        bits.append('required')
    extra = ''
    if field.get('options'):
        opts = [o for o in field['options'] if o and o.lower() not in ('select', '--select--', '')][:6]
        if opts:
            extra = ' — ' + ', '.join(opts)
    return f"`{label}` ({', '.join(bits)}){extra}"


def form_block(form, index=None):
    fields = form.get('fields', [])
    shown = fields[:MAX_FIELDS_PER_FORM]
    text = '; '.join(field_line(f) for f in shown)
    if len(fields) > len(shown):
        text += f"; … +{len(fields) - len(shown)} more"
    head = f"**Form {index}**" if index else '**Form**'
    if form.get('action'):
        head += f" (posts to `/{form['action'].split('.in/', 1)[-1]}`)"
    if form.get('visible') is False:
        head += ' *(dialog)*'
    return f"- {head}: {text}"


def pretty_title(rec):
    p = rec.get('profile') or {}
    title = (p.get('pageTitle') or '').strip()
    if not title or 'Smart Hospital' in title or title.lower() in ('patient', 'dashboard'):
        title = rec.get('label') or title
    return title


def main():
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    index = jload(os.path.join(CAP, 'index.json'), []) or []
    by_id = {r['id']: r for r in index}

    roles = {}
    rdir = os.path.join(CAP, 'roles')
    if os.path.isdir(rdir):
        for f in sorted(os.listdir(rdir)):
            if f.endswith('.json') and not f.endswith('nav.json'):
                r = jload(os.path.join(rdir, f))
                if r and r.get('role'):
                    roles[r['role']] = r

    dialogs = {}
    ddir = os.path.join(CAP, 'forms')
    if os.path.isdir(ddir):
        for f in sorted(os.listdir(ddir)):
            if f.endswith('.json'):
                d = jload(os.path.join(ddir, f))
                if d and d.get('pageId'):
                    dialogs.setdefault(d['pageId'], []).append(d)

    detail = []
    tdir = os.path.join(CAP, 'detail')
    if os.path.isdir(tdir):
        for f in sorted(os.listdir(tdir)):
            if f.endswith('.json') and '__tab-' not in f:
                d = jload(os.path.join(tdir, f))
                if d:
                    detail.append(d)

    # sub-screens reachable but not present in the menu
    subs = []
    sdir = os.path.join(CAP, 'subs')
    if os.path.isdir(sdir):
        for f in sorted(os.listdir(sdir)):
            if f.endswith('.json'):
                d = jload(os.path.join(sdir, f))
                prof = (d or {}).get('profile') or {}
                title = (prof.get('pageTitle') or '')
                status = d.get('status') if d else None
                if not d or d.get('error') or 'Page Not Found' in title or (status not in (None, 200)):
                    continue
                subs.append(d)

    # record views captured in the second pass
    detail2 = []
    d2dir = os.path.join(CAP, 'detail2')
    if os.path.isdir(d2dir):
        for f in sorted(os.listdir(d2dir)):
            if f.endswith('.json') and '__tab-' not in f:
                d = jload(os.path.join(d2dir, f))
                if d and d.get('profile'):
                    detail2.append(d)

    front = jload(os.path.join(CAP, 'frontsite', 'index.json'), {}) or {}
    today = datetime.date.today().isoformat()
    n_dialogs = sum(len([d for d in v if (d.get('form') or {}).get('fieldCount', 0) >= 3]) for v in dialogs.values())

    L = []
    A = L.append

    # ------------------------------------------------------------- header ---
    A('# Smart Hospital — Complete Feature Catalogue')
    A('')
    A('> **Evidence-based product documentation**, generated from a live screen-by-screen exploration of the '
      '**Smart Hospital** hospital-management system (by QDOCS) running at `demo.smart-hospital.in`.')
    A('>')
    A(f'> Captured on **{today}**: {len(index)} application screens, {n_dialogs} data-entry dialogs, '
      f'{len(detail)} record/tab views, {len(roles)} role dashboards and the public website.')
    A('')
    A('| | |')
    A('|---|---|')
    A('| Product | Smart Hospital — Hospital Management System |')
    A('| Vendor | QDOCS · https://www.smart-hospital.in |')
    A('| Explored instance | https://demo.smart-hospital.in (Smart Hospital & Research Center) |')
    A('| Sign-in used | `superadmin@gmail.com` / `password` (plus all nine demo roles) |')
    A('| Technology (vendor docs) | PHP (CodeIgniter MVC) + MySQL · Bootstrap · jQuery/DataTables · Chart.js (server-rendered views) |')
    A('| Navigation | 5 sections → 30 menu items → 76 screens |')
    A('| Roles | Super Admin, Admin, Doctor, Nurse, Pharmacist, Pathologist, Radiologist, Accountant, Receptionist + Patient portal |')
    A('')
    A('**Companion documents**')
    A('')
    A('| File | Contents |')
    A('|---|---|')
    A('| `docs/WIKI.md` | Operator handbook — how to run every module, role by role |')
    A('| `docs/Smart-Hospital-Complete-Guide.pdf` | Printable guide: wiki + this catalogue + screenshots + backlog |')
    A('| `docs/IMPROVEMENT-BACKLOG.md` | Findings and the prioritised improvement backlog for the next phase |')
    A('| `docs/COVERAGE.md` | Exactly what was captured, how, and what is out of scope |')
    A('| `docs/HELP-LIBRARY.md` | Offline mirror of the vendor knowledge base (categories + every article) |')
    A('| `capture/` | Raw evidence: screenshots, DOM profiles, role menu trees, logs |')
    A('')

    # --------------------------------------------------------- application ---
    A('## 1. Application map')
    A('')
    A('```')
    A('Smart Hospital')
    for sec in MODULES:
        A(f"├── {sec['section']}")
        for pid in sec['ids']:
            rec = by_id.get(pid)
            if rec:
                A(f"│   ├── {rec['label']}")
    A('└── Public website (Front CMS) + Patient portal')
    A('```')
    A('')
    A('### 1.1 The application shell')
    A('')
    A('Every screen sits inside the same shell:')
    A('')
    A('- **Sidebar** with a live *Filter Menu* box, grouped into the five sections above, collapsible sub-menus and per-item icons.')
    A('- **Header**: *Search By Patient Name* (global patient index search), the **Quick Add** launcher (Add Patient · New OPD Patient · New IPD Patient · New Appointment · New Bill), **Bed Status** board, language switcher, calendar, chat, the notification bell (module alerts) and the user menu (profile, password, sign out).')
    A('- **Work area** with breadcrumb/page title, DataTables grids (search, sort, paginate, export/print), Bootstrap modals for every add/edit form, and print/PDF output for documents.')
    A('')
    A('### 1.2 Screen inventory at a glance')
    A('')
    A('| Section | Screens | Modules |')
    A('|---|---|---|')
    for sec in MODULES:
        mods = ', '.join(sorted({by_id[i]['label'].split(' › ')[0] for i in sec['ids'] if i in by_id}))
        A(f"| {sec['section'].title()} | {len(sec['ids'])} | {mods} |")
    A('')

    # ------------------------------------------------------------- modules ---
    A('## 2. Modules, screens and forms')
    A('')
    for i, mod in enumerate(MODULES, start=1):
        A(f"### 2.{i} {mod['name']}")
        A('')
        A(mod['purpose'])
        A('')
        A('**Key capabilities**')
        A('')
        for h in mod['highlights']:
            A(f'- {h}')
        A('')

        rows = []
        for pid in mod['ids']:
            rec = by_id.get(pid)
            if not rec:
                continue
            rows.append({'id': pid, 'rec': rec, 'prof': rec.get('profile') or {}})

        A('| # | Screen | What it covers | Path |')
        A('|---|---|---|---|')
        for n, r in enumerate(rows, start=1):
            path = '/' + r['rec']['url'].split('.in/', 1)[-1] if '.in/' in r['rec']['url'] else r['rec']['url']
            A(f"| {n} | **{pretty_title(r['rec'])}** | {PAGE_NOTES.get(r['id'], r['rec']['label'])} | `{path}` |")
        A('')

        for n, r in enumerate(rows, start=1):
            prof = r['prof']
            rec = r['rec']
            A(f"#### Screen {i}.{n} — {pretty_title(rec)}")
            A('')
            url = rec['url'].split('.in/', 1)[-1]
            A(f"- **Menu path:** {rec['section'].title()} → {rec['label']} · **URL:** `/{url}`")
            A(f"- **Purpose:** {PAGE_NOTES.get(r['id'], rec['label'])}")
            if prof.get('tabs'):
                A(f"- **Tabs:** {' · '.join(t for t in prof['tabs'] if t)}")
            for t in prof.get('tables', [])[:4]:
                cols = [c for c in (t.get('columns') or []) if c]
                if cols:
                    A(f"- **Grid ({t.get('rows', '?')} rows):** {' | '.join(cols[:12])}")
            if prof.get('sections'):
                panels = [p for p in prof['sections'][:8] if p]
                if panels:
                    A(f"- **Panels on screen:** {' · '.join(panels)}")
            btns, seen_b = [], set()
            for b in prof.get('buttons', []):
                t = (b.get('text') or '').strip()
                if not t or len(t) > 34 or t.lower() in ('close', 'cancel', 'remove'):
                    continue
                if t in seen_b:
                    continue
                seen_b.add(t)
                btns.append(t)
            if btns:
                A(f"- **Actions:** {', '.join(btns[:14])}")
            fl = [f for f in prof.get('filters', []) if f and 'Filter Menu' not in f and 'Search By Patient Name' not in f
                  and 'Type to search' not in f and 'DataTables' not in f][:10]
            if fl:
                A(f"- **Search / filters:** {', '.join(fl)}")

            forms = clean_forms(prof)
            uniq_forms, sigs = [], set()
            for form in forms:
                s = signature(form)
                if s in sigs or not s:
                    continue
                sigs.add(s)
                uniq_forms.append(form)
            for k, form in enumerate(uniq_forms[:3], start=1):
                A(form_block(form, k))
            A('')
            shot = copy_shot(os.path.join(CAP, 'pages', r['id'] + '.jpg'), r['id'] + '.jpg')
            if shot:
                A(f"![{pretty_title(rec)}](assets/screens/{shot})")
                A('')

        # dialogs gallery for this module
        gallery = []
        for pid in mod['ids']:
            for d in dialogs.get(pid, []):
                title = ((d.get('form') or {}).get('modalTitle') or '').strip()
                fields = (d.get('form') or {}).get('fieldCount') or 0
                trig = (d.get('trigger') or {}).get('label') or ''
                if fields < 3 or not title:
                    continue
                if title.lower() in IGNORE_TRIGGERS:
                    continue
                if not DIALOG_KEYWORDS.search(title + ' ' + trig):
                    continue
                key = (pid, slugify(title))
                if key in {(g['pageId'], g['slug']) for g in gallery}:
                    continue
                gallery.append({'pageId': pid, 'title': title, 'fields': fields, 'trigger': trig,
                                'slug': slugify(title), 'file': d.get('file'), 'json': d})
        if gallery:
            A(f"#### Module {i} — data-entry dialogs captured")
            A('')
            A('| Screen | Dialog | Fields | Screenshot |')
            A('|---|---|---|---|')
            embedded = 0
            for g in gallery:
                shot = copy_shot(os.path.join(CAP, 'forms', g['file'] or ''), f"{g['pageId']}__{g['slug']}.jpg")
                A(f"| {pretty_title(by_id[g['pageId']])} | **{g['title']}** | {g['fields']} | `{shot or '—'}` |")
                if shot and embedded < 4:
                    embedded += 1
            A('')
            for g in gallery:
                shot = copy_shot(os.path.join(CAP, 'forms', g['file'] or ''), f"{g['pageId']}__{g['slug']}.jpg")
                if not shot:
                    continue
                forms_in = clean_forms((g['json'].get('profile') or {}))
                A(f"**{g['title']}** — opened from *{pretty_title(by_id[g['pageId']])}*")
                A('')
                if forms_in:
                    A(form_block(forms_in[0]))
                    A('')
                A(f"![{g['title']}](assets/screens/{shot})")
                A('')
        A('')

    # ------------------------------------------------------- detail views ---
    seen_names, records = set(), []
    for d in [d for d in detail2] + [d for d in detail]:
        name = d.get('id') or d.get('name') or ''
        if name in seen_names:
            continue
        seen_names.add(name)
        records.append(d)
    if records:
        A('## 3. Record-level screens (opened from real data)')
        A('')
        A('These screens were reached by opening an actual record from a list, so they show the real clinical and financial layout, '
          'including every tab of the record.')
        A('')
        for d in records:
            base = d.get('id') or d.get('name') or ''
            prof = d.get('profile') or {}
            title = DETAIL_TITLES.get(base, prof.get('pageTitle') or base)
            srcdir = 'detail2' if os.path.exists(os.path.join(CAP, 'detail2', base + '.jpg')) else 'detail'
            shot = copy_shot(os.path.join(CAP, srcdir, base + '.jpg'), 'detail-' + base + '.jpg')
            A(f"### 3.{records.index(d) + 1} {title}")
            A('')
            A(f"- **Opened from:** `/{str(d.get('listUrl', '')).split('.in/', 1)[-1]}` → `/{str(d.get('href', '')).split('.in/', 1)[-1]}`")
            A(f"- **Screenshot:** `docs/assets/screens/{shot or ''}`")
            if prof.get('tabs'):
                A(f"- **Record tabs:** {' · '.join(t for t in prof['tabs'] if t)}")
            for t in prof.get('tables', [])[:3]:
                cols = [c for c in (t.get('columns') or []) if c]
                if cols:
                    A(f"- **Table:** {' | '.join(cols[:10])}")
            for form in clean_forms(prof)[:2]:
                A(form_block(form))
            A('')
            if shot:
                A(f"![{title}](assets/screens/{shot})")
                A('')
            tabs = [f for f in sorted(os.listdir(os.path.join(CAP, srcdir))) if f.startswith(base + '__tab-') and f.endswith('.jpg')]
            tabs.sort(key=lambda x: int(re.search(r'__tab-(\d+)', x).group(1)) if re.search(r'__tab-(\d+)', x) else 99)
            if tabs:
                A(f"**Tabs of this record**")
                A('')
                for tf in tabs:
                    tslug = slugify(tf.replace('.jpg', '').split('__tab-', 1)[-1])
                    tshot = copy_shot(os.path.join(CAP, srcdir, tf), f"detail-{base}__{tslug}.jpg")
                    label = tf.replace('.jpg', '').split('__tab-', 1)[-1].replace('-', ' ')
                    if tshot:
                        A(f"![{title} — {label}](assets/screens/{tshot})")
                        A('')

    # -------------------------------------------------------- sub-screens ---
    if subs:
        A('## 4. Sub-screens reachable from the modules')
        A('')
        A('These screens are not menu entries but are reachable from the modules above (per-module billing, master imports, '
          'return registers, status boards, payroll …). They are part of the product surface and are captured here for completeness.')
        A('')
        A('| # | Screen | Path | Purpose |')
        A('|---|---|---|---|')
        for n, d in enumerate(subs, start=1):
            prof = d.get('profile') or {}
            tt = (prof.get('pageTitle') or '').strip()
            if not tt or 'Smart Hospital' in tt or tt.lower() in ('patient', 'dashboard'):
                tt = (d.get('label') or tt or '').strip()
            purp = PAGE_NOTES.get(d.get('id', ''), '')
            if not purp:
                cols = []
                for t in (prof.get('tables') or [])[:1]:
                    cols = [c for c in (t.get('columns') or []) if c][:6]
                purp = ('Grid: ' + ' | '.join(cols)) if cols else (d.get('label') or '')
            A(f"| {n} | **{tt}** | `{d.get('url', '')}` | {purp} |")
        A('')
        for n, d in enumerate(subs, start=1):
            prof = d.get('profile') or {}
            tt = (prof.get('pageTitle') or '').strip()
            if not tt or 'Smart Hospital' in tt or tt.lower() in ('patient', 'dashboard'):
                tt = (d.get('label') or tt or '').strip()
            shot = copy_shot(os.path.join(CAP, 'subs', d.get('file', '')), 'sub-' + str(d.get('file', '')))
            A(f"### 4.{n} {tt} — `{d.get('url', '')}`")
            A('')
            if prof.get('tabs'):
                A(f"- **Tabs:** {' · '.join(t for t in prof['tabs'] if t)}")
            for t in prof.get('tables', [])[:3]:
                cols = [c for c in (t.get('columns') or []) if c]
                if cols:
                    A(f"- **Grid ({t.get('rows', '?')} rows):** {' | '.join(cols[:12])}")
            for form in clean_forms(prof)[:2]:
                A(form_block(form))
            A('')
            if shot:
                A(f"![{tt}](assets/screens/{shot})")
                A('')
        A('')

    # ------------------------------------------------------------- roles ---
    A('## 5. Roles and access model')
    A('')
    A('Nine staff roles plus the patient portal. Each role gets its own dashboard and its own slice of the menu; '
      'the table below was produced by logging in as each role and reading the rendered sidebar.')
    A('')
    A('| Role | Demo user | Sections visible | Screens reachable | Landing page |')
    A('|---|---|---|---|---|')
    for key, (label, _desc) in ROLE_DESCRIPTIONS.items():
        r = roles.get(key)
        if not r:
            continue
        secs = ', '.join(s['name'].title() for s in (r.get('nav') or {}).get('sections', []))
        A(f"| **{label}** | `{r.get('user', '')}` | {secs} | {r.get('pageCount', '?')} | `/{str(r.get('landing', '')).split('.in/', 1)[-1]}` |")
    A('')
    for key, (label, desc) in ROLE_DESCRIPTIONS.items():
        r = roles.get(key)
        if not r:
            continue
        shot = copy_shot(os.path.join(CAP, 'roles', key, 'dashboard.jpg'), f"role-{key}-dashboard.jpg")
        A(f"### 5.{list(ROLE_DESCRIPTIONS).index(key) + 1} {label}")
        A('')
        A(f"{desc.capitalize()}.")
        A('')
        for s in (r.get('nav') or {}).get('sections', []):
            items = [it['label'] for it in s.get('items', [])]
            if items:
                A(f"- **{s['name'].title()}:** {', '.join(items)}")
        if r.get('pages'):
            A('')
            A('Screens captured for this role: ' + ', '.join(
                f"{p.get('label', '')}" + (f" (`/{str(p.get('url', '')).split('.in/', 1)[-1]}`)" if p.get('url') else '')
                for p in r['pages'][:6]))
        A('')
        if shot:
            A(f"![{label} dashboard](assets/screens/{shot})")
            A('')

    # ------------------------------------------------------------ portal ---
    if front:
        A('## 6. Public website and patient portal')
        A('')
        home = front.get('home') or {}
        A('The same installation serves the public hospital website (driven by Front CMS) and a patient self-service portal.')
        A('')
        if home.get('headings'):
            A('- **Home page blocks:** ' + ' · '.join(home['headings'][:12]))
        if front.get('links'):
            A('- **Public pages discovered:** ' + ', '.join(f"{l.get('label', '')} (`/{str(l.get('url', '')).split('.in/', 1)[-1]}`)" for l in front['links'][:14]))
        A('')
        for p in front.get('pages', [])[:10]:
            shot = copy_shot(os.path.join(CAP, 'frontsite', p.get('file', '')), 'front-' + str(p.get('file', '')))
            if shot:
                A(f"![{p.get('label', '')}](assets/screens/{shot})")
                A('')
        portal = copy_shot(os.path.join(CAP, 'frontsite', 'patient-portal-login.jpg'), 'patient-portal-login.jpg')
        if portal:
            A('**Patient portal sign-in** (`/site/userlogin`) — patients use the e-mail captured at registration to see appointments, '
              'prescriptions, investigations and bills.')
            A('')
            A(f"![Patient portal sign-in](assets/screens/{portal})")
            A('')

    # ------------------------------------------------------- cross cutting ---
    A('## 7. Cross-cutting platform features')
    A('')
    A('| Capability | What it does |')
    A('|---|---|')
    for k, v in [
        ('Authentication', 'Separate admin and patient sign-in endpoints (`/site/login`, `/site/userlogin`), CSRF token on every form, forgot-password for both portals, password hashing.'),
        ('Role-based access control', 'Nine staff roles controlling sidebar, screens and reports; role is set on the staff record.'),
        ('Multi-branch', 'Branch master, branch switching from the header, consolidated overview and cross-branch reporting.'),
        ('Global patient search', 'Persistent header search over the patient index, available from every screen.'),
        ('Quick Add launcher', 'Floating launcher for the five most used create actions from anywhere in the app.'),
        ('Bed status board', 'Live occupancy modal in the header, plus the bed master screen.'),
        ('Notifications', 'Bell menu with module alerts (OPD/IPD/pathology/radiology/pharmacy/appointment), notice board and chat.'),
        ('Printing & PDF', 'Bills, receipts, prescriptions, lab/radiology reports, certificates and ID cards, each with a configurable per-module header/footer.'),
        ('Data grids', 'DataTables on every list: search, sort, pagination, page length and CSV/print/copy export.'),
        ('Dashboards & analytics', 'KPI tiles, line and donut charts, module income share, staff attendance and activity feed.'),
        ('Charge master', 'Central catalogue of billable items reused by billing, OPD and IPD.'),
        ('Clinical libraries', 'Symptoms, findings, vitals, ICD-10 codes and prescription sets shared across clinical screens.'),
        ('Custom fields', 'Extend core entities with hospital-specific fields from Setup → Custom Fields.'),
        ('Localisation', 'Language switcher and phrase files (multi-language per vendor documentation).'),
        ('Communication', 'Notice board, messaging, survey forms, download centre and e-mail/SMS notification settings.'),
        ('Telemedicine', 'Zoom integration for live consultations and internal meetings.'),
        ('QR attendance', 'QR-code based staff check-in with roster and holiday calendar.'),
        ('Audit trail', 'System log report plus the dashboard activity feed (who did what, in which module, when).'),
        ('Two-factor authentication', 'Optional Google Authenticator (TOTP) 2FA for superadmin and staff: enrol, reset and manual key configuration.'),
        ('Notification engine', 'Event-driven notifications with per-event channel toggles across in-app, e-mail, SMS, WhatsApp and mobile push.'),
        ('WhatsApp messaging', 'Patient/staff notifications over WhatsApp via Meta (Cloud API) or Twilio — one provider active at a time, reusing the event template.'),
        ('Mobile app', 'Vendor Android app for staff and patients with push notifications (documented in the vendor help library, not part of this screen capture).'),
        ('Patient panel', 'Patient self-service portal: personal dashboard with charts, appointment booking, OPD/IPD history, pharmacy/pathology/radiology/blood-bank/ambulance bills and Zoom live consultation.'),
    ]:
        A(f"| **{k}** | {v} |")
    A('')

    # ---------------------------------------------------------- inventory ---
    A('## 8. Complete screen inventory')
    A('')
    A('| # | Section | Menu item | Screen | URL | Screenshot |')
    A('|---|---|---|---|---|---|')
    for n, r in enumerate(index, start=1):
        url = '/' + r['url'].split('.in/', 1)[-1] if '.in/' in r['url'] else r['url']
        A(f"| {n} | {r['section'].title()} | {r['label']} | {pretty_title(r)} | `{url}` | `{r['id']}.jpg` |")
    A('')
    A('---')
    A('')
    A(f'_Generated automatically from the capture pipeline in `tools/` on {today}. '
      'Re-run with `python3 tools/docs/build_docs.py` after a new capture._')
    A('')

    with open(os.path.join(DOCS, 'FEATURE-CATALOG.md'), 'w') as f:
        f.write('\n'.join(L) + '\n')

    summary = {
        'generated': today,
        'counts': {'screens': len(index), 'forms': n_dialogs, 'detail': len(records), 'roles': len(roles), 'subs': len(subs)},
        'screens': [{'id': r['id'], 'label': r['label'], 'section': r['section'], 'title': pretty_title(r)} for r in index],
    }
    with open(os.path.join(BUILD, 'catalog.json'), 'w') as f:
        json.dump(summary, f, indent=1)
    print(f"catalogue: {os.path.join(DOCS, 'FEATURE-CATALOG.md')}")
    print(f"screens={len(index)} dialogs={n_dialogs} records={len(records)} subs={len(subs)} roles={len(roles)} front={len(front.get('pages', []))}")


if __name__ == '__main__':
    main()
