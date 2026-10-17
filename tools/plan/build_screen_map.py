#!/usr/bin/env python3
"""
Generate docs/plan/03-SCREEN-MAP.md - the migration map for the modernization.

For every screen captured from the live application it derives:
  * the new phase it will be rebuilt in (mapping below)
  * a complexity size (S/M/L) computed from the captured evidence:
    form fields, grid columns, tabs and dialogs
  * the modules/components the new UI needs for it

Run: python3 tools/plan/build_screen_map.py
"""
import json
import os
import re
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CAP = os.path.join(ROOT, 'capture')
OUT = os.path.join(ROOT, 'docs', 'plan', '03-SCREEN-MAP.md')

PHASES = [
    ('P0', 'Foundations',
     'Design system, app shell, identity, environments, API conventions. No legacy screen is replaced yet.',
     [], []),
    ('P1', 'Identity, patients, appointments',
     'Sign-in/SSO, MFA, role-aware home, patient master (register/search/profile/import), appointment booking + queue.',
     ['001-dashboard', '002-patient', '004-appointment'],
     ['09-patient-import', '11-discharged-patients', '19-appointment-queue']),
    ('P2', 'Billing and OPD consultation',
     'Charge master, single-module and case-based billing, payments, receipts, the OPD consultation workspace.',
     ['003-billing', '005-opd-out-patient', '057-setup-hospital-charges'],
     ['01-billing-appointment-module', '02-billing-opd-module', '07-billing-bill-dashboard',
      '08-billing-opd-bill-screen', '20-opd-patient-view']),
    ('P3', 'Pharmacy and inventory',
     'Pharmacy point of sale with batch/expiry safety, stock, purchase/return, item inventory.',
     ['007-pharmacy', '030-inventory', '062-setup-pharmacy', '075-setup-inventory'],
     ['12-pharmacy-search', '13-pharmacy-sale-return-bills']),
    ('P4', 'Laboratory, imaging, blood bank and ambulance',
     'Order → specimen → result → report flows with barcode support, imaging worklist, blood bank safety, ambulance dispatch.',
     ['008-pathology', '009-radiology', '010-blood-bank', '011-ambulance',
      '063-setup-pathology', '064-setup-radiology', '065-setup-blood-bank',
      '066-setup-symptoms', '067-setup-icd-10', '068-setup-findings', '069-setup-vitals'],
     ['03-billing-pathology-module', '04-billing-radiology-module', '05-billing-issue-blood',
      '06-billing-issue-component', '14-pathology-search', '15-radiology-search', '16-blood-bank-status-board']),
    ('P5', 'In-patient, ward and operation theatre',
     'Admissions, bed board, nursing documentation, medication administration, OT scheduling, ward handover.',
     ['006-ipd-in-patient', '058-setup-bed', '061-setup-operations', '021-duty-roster'],
     []),
    ('P6', 'Finance, insurance and reporting',
     'Income/expense, TPA/insurance claim pipeline, referral payouts, the report centre and management dashboards.',
     ['025-finance-income', '026-finance-expenses', '023-referral', '024-tpa-management',
      '071-setup-finance', '073-setup-referral',
      '040-reports-finance', '041-reports-appointment', '042-reports-opd', '043-reports-ipd',
      '044-reports-pharmacy', '045-reports-pathology', '046-reports-radiology', '047-reports-blood-bank',
      '048-reports-ambulance', '049-reports-birth-death', '050-reports-human-resource', '051-reports-tpa',
      '052-reports-inventory', '053-reports-live-consultation', '054-reports-log', '055-reports-ot',
      '056-reports-patient'],
     []),
    ('P7', 'People, front office and administration',
     'HR (staff, attendance, payroll, leaves), front office registers, birth/death registry, multi-branch console, print templates, settings.',
     ['012-front-office', '013-birth-death-record-birth-record', '014-birth-death-record-death-record',
      '015-multi-branch-overview', '016-multi-branch-report', '017-multi-branch-settings',
      '018-human-resource', '019-qr-code-attendance-attendance', '020-qr-code-attendance-settings',
      '022-annual-calendar', '059-setup-print-header-footer', '060-setup-front-office',
      '070-setup-zoom-setting', '072-setup-human-resource', '074-setup-appointment', '076-setup-custom-fields'],
     ['17-staff-attendance-register', '18-payroll']),
    ('P8', 'Communication, content, patient portal and website',
     'Notice board, surveys, download centre, certificates and ID cards, Front CMS, telemedicine, patient portal and public site.',
     ['027-survey-forms-survey-forms', '028-survey-forms-my-survey-forms', '029-messaging',
      '031-download-center-upload-share-content', '032-download-center-content-share-list',
      '033-download-center-content-type', '034-certificate-certificate', '035-certificate-patient-id-card',
      '036-certificate-staff-id-card', '037-front-cms', '038-live-consultation-live-consultation',
      '039-live-consultation-live-meeting'],
     []),
]

# components the new UI needs, keyed by keywords found in the screen profile
COMPONENT_RULES = [
    ('grid', 'DataGrid (server-side paging, saved views, column chooser, CSV export)'),
    ('form', 'Form primitives + validation schema'),
    ('tabs', 'Tabs / detail layout'),
    ('kpi', 'KPI tiles + charts'),
    ('queue', 'Queue/token board'),
    ('billing', 'Money input, charge picker, payment panel, receipt print'),
    ('pharmacy', 'Stock/batch picker, expiry guard, POS cart'),
    ('lab', 'Order composer, specimen barcode, result grid, report preview'),
    ('prescription', 'Prescription pad with drug interactions'),
    ('print', 'Print/PDF templates'),
    ('calendar', 'Calendar / roster planner'),
    ('attendance', 'QR/Biometric check-in flow'),
]


def jload(p, default=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default


def complexity(profile, dialog_count):
    """Very simple, evidence based sizing for the rebuild effort."""
    fields = 0
    forms = profile.get('forms') or []
    seen = set()
    for f in forms:
        sig = tuple(sorted((x.get('name') or x.get('label') or '') for x in f.get('fields', []) or []))
        if sig in seen:
            continue
        seen.add(sig)
        fields += len(sig)
    grids = len(profile.get('tables') or [])
    max_cols = max([len(t.get('columns') or []) for t in (profile.get('tables') or [])] or [0])
    tabs = len([t for t in (profile.get('tabs') or []) if t])
    filters = len(profile.get('filters') or [])
    score = fields / 12 + grids * 1.2 + max_cols / 4 + tabs * 1.6 + filters / 10 + dialog_count * 1.5
    if score < 6:
        size = 'S'
    elif score < 14:
        size = 'M'
    else:
        size = 'L'
    return size, fields, grids, max_cols, tabs, filters, round(score, 1)


SIZE_DAYS = {'S': 3, 'M': 7, 'L': 14}


def components_for(name, profile):
    hay = (name + ' ' + ' '.join(profile.get('tabs') or []) + ' ' +
           ' '.join(profile.get('pageTitle', '') for _ in [0])).lower()
    if profile.get('tables'):
        hay += ' grid'
    if profile.get('forms'):
        hay += ' form'
    return [label for kw, label in COMPONENT_RULES if kw in hay]


def main():
    idx = jload(os.path.join(CAP, 'index.json'), []) or []
    entries = {r['id']: r for r in idx}
    dialogs = collections.Counter()
    for f in os.listdir(os.path.join(CAP, 'forms')) if os.path.isdir(os.path.join(CAP, 'forms')) else []:
        if f.endswith('.json'):
            d = jload(os.path.join(CAP, 'forms', f)) or {}
            if d.get('pageId'):
                dialogs[d['pageId']] += 1
    subs = {}
    sdir = os.path.join(CAP, 'subs')
    if os.path.isdir(sdir):
        for f in sorted(os.listdir(sdir)):
            if f.endswith('.json'):
                d = jload(os.path.join(sdir, f)) or {}
                subs[os.path.basename(f).replace('.json', '')] = d

    L = []
    A = L.append
    A('# Screen migration map')
    A('')
    A('Every screen captured from the running application, assigned to the delivery phase that will replace it, '
      'sized from the captured evidence (form fields, grid columns, tabs, dialogs) and annotated with the components '
      'the new UI needs for it.')
    A('')
    A('Sizes are planning estimates: **S ≈ 3**, **M ≈ 7**, **L ≈ 14** engineer-days for one screen including API, '
      'tests and design QA.')
    A('')

    total_days = 0
    summary = []
    for code, name, purpose, ids, sub_ids in PHASES:
        rows = []
        for i in ids:
            rec = entries.get(i)
            if not rec:
                continue
            prof = rec.get('profile') or {}
            size, fields, grids, max_cols, tabs, filters, score = complexity(prof, dialogs.get(i, 0))
            rows.append({'id': i, 'label': rec['label'], 'url': rec['url'].split('.in/', 1)[-1],
                         'size': size, 'fields': fields, 'grids': grids, 'max_cols': max_cols,
                         'tabs': tabs, 'filters': filters, 'score': score,
                         'dialogs': dialogs.get(i, 0),
                         'comps': components_for(rec['label'], prof)})
        days = sum(SIZE_DAYS[r['size']] for r in rows)
        days += sum(SIZE_DAYS['M'] for _ in sub_ids)
        total_days += days
        summary.append((code, name, len(rows), len(sub_ids), days))
        A(f'## {code} — {name}')
        A('')
        A(purpose)
        A('')
        A(f"**Scope:** {len(rows)} application screens · {len(sub_ids)} sub-screens · "
          f"**≈ {days} engineer-days** (excluding platform work and design system).")
        A('')
        if rows:
            A('| Screen | Legacy path | Size | Fields | Grids | Max cols | Tabs | Dialogs | Score | Components needed |')
            A('|---|---|---|---|---|---|---|---|---|---|')
            for r in sorted(rows, key=lambda x: (-x['score'])):
                comps = ', '.join(sorted(set(x.split(' (')[0] for x in r['comps']))[:4]) or '—'
                A(f"| **{r['label']}** | `/{r['url']}` | {r['size']} | {r['fields']} | {r['grids']} | "
                  f"{r['max_cols']} | {r['tabs']} | {r['dialogs']} | {r['score']} | {comps} |")
        if sub_ids:
            A('')
            A('Sub-screens: ' + ', '.join(f"`{s}`" + (f" ({subs[s]['profile'].get('pageTitle', '')})"
                                                        if s in subs and subs[s].get('profile') else '')
                                          for s in sub_ids))
        A('')

    A('## Summary')
    A('')
    A('| Phase | Theme | Screens | Sub-screens | Est. engineer-days |')
    A('|---|---|---|---|---|')
    for code, name, n, ns, days in summary:
        A(f'| {code} | {name} | {n} | {ns} | {days} |')
    A(f"| | **Total** | **{sum(s[2] for s in summary)}** | **{sum(s[3] for s in summary)}** | **{total_days}** |")
    A('')
    A('> Add roughly 30–40% on top for platform work (auth, API layer, events, observability, CI/CD, data migration) and '
      '20% for design system, research and usability testing. The roadmap in `04-ROADMAP.md` sequences these phases with that overhead included.')
    A('')
    A('---')
    A('')
    A('_Generated by `tools/plan/build_screen_map.py` from `capture/` — re-run after a new capture to refresh the sizes._')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write('\n'.join(L) + '\n')
    print(f'wrote {OUT}: {sum(s[2] for s in summary)} screens, {sum(s[3] for s in summary)} sub-screens, {total_days} engineer-days')


if __name__ == '__main__':
    main()
