#!/usr/bin/env python3
"""
Build docs/HELP-LIBRARY.md (the navigable index of the mirrored vendor help
library) and docs/build/help.json (consumed by build_html.py for the PDF).

Reads   docs/help-library/index.json  (produced by fetch_help.py)
Writes  docs/HELP-LIBRARY.md
        docs/build/help.json
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')
LIB = os.path.join(DOCS, 'help-library')
BUILD = os.path.join(DOCS, 'build')

# Articles that add knowledge the on-screen exploration could not show, or that
# are operationally critical. Printed in full in the PDF guide (Part 5).
SELECTED = [
    # security / access
    ('two-factor-authentication', 'about-two-factor-authentication'),
    ('two-factor-authentication', 'how-to-setup-2fa'),
    ('two-factor-authentication', 'how-to-install-the-google-authenticator-app-on-a-mobile-device'),
    ('two-factor-authentication', 'how-to-delete-the-2fa-account-for-superadmin-or-staff'),
    # notifications & messaging
    ('whatsapp-messaging', 'about-whatsapp-messaging'),
    ('whatsapp-messaging', 'how-to-configure-whatsapp-using-meta-cloud-api'),
    ('whatsapp-messaging', 'how-to-configure-whatsapp-using-twilio'),
    ('whatsapp-messaging', 'how-to-enable-whatsapp-for-a-notification-event'),
    ('system-settings', 'notification-setting'),
    ('system-settings', 'system-notification-setting'),
    ('system-settings', 'sms-setting'),
    ('system-settings', 'email-setting'),
    ('messaging', 'how-notice-board-works'),
    ('messaging', 'how-send-patient-credential-in-smart-hospital'),
    # patient panel (portal) - not reachable from the admin demo
    ('patient-panel', 'patient-dashboard'),
    ('patient-panel', 'how-to-add-appointment-from-patient-panel'),
    ('patient-panel', 'opd'),
    ('patient-panel', 'ipd'),
    ('patient-panel', 'pharmacy-1'),
    ('patient-panel', 'pathology-1'),
    ('patient-panel', 'radiology-1'),
    ('patient-panel', 'blood-bank-1'),
    ('patient-panel', 'ambulance'),
    ('patient-panel', 'live-consultation'),
    # billing depth
    ('billing', 'about-billing'),
    ('billing', 'single-module-billing'),
    ('billing', 'opdipd-billing-through-case-id'),
    # clinical
    ('ipd-in-patient', 'ipd-overview'),
    ('ipd-in-patient', 'bmi-for-ipd-in-patient'),
    ('opd-out-patient', 'opd-patient-visits'),
    ('pharmacy', 'how-to-import-medicines'),
    ('blood-bank', 'how-to-issue-blood'),
    ('ambulance', 'how-to-add-ambulance-call'),
    ('front-office', 'how-to-add-phone-call-log-in-smart-hospital'),
    ('certificate', 'how-to-generate-certificate'),
    ('inventory', 'how-to-check-issue-and-return-item'),
    ('download-center', 'about-download-center'),
    ('front-cms', 'how-media-manager-works-in-smart-hospital'),
    ('front-cms', 'how-to-add-gallery-in-smart-hospital'),
    ('multi-branch', 'how-to-switch-the-branch'),
    ('qr-code-attendance', 'about-qr-code-attendance'),
    ('duty-roster', 'how-to-assign-the-roster-to-the-staff'),
    ('annual-calendar', 'how-to-add-holiday-in-annual-calendar-on-smart-hospital'),
    ('survey-form', 'how-to-create-a-survey-form'),
    ('referral', 'how-to-add-referral-payment'),
    ('tpa-management', 'tpa-management'),
    ('live-consultation', 'how-to-add-live-consultation-in-smart-hospital'),
    # operations
    ('setup-configuration', 'patient'),
    ('setup-configuration', 'hospital-charges'),
    ('setup-configuration', 'bed'),
    ('setup-configuration', 'print-header-footer'),
    ('appointment', 'about-appointment'),
    ('appointment', 'setup-for-appointment'),
    ('reports', 'daily-transaction-report'),
    ('reports', 'stock-report'),
    # troubleshooting
    ('common-issues-troubleshooting', '404-or-page-not-found-error-in-installation'),
    ('common-issues-troubleshooting', 'unable-to-login-or-missing-login-url'),
    ('common-issues-troubleshooting', 'only_full_group_by-issue-on-server'),
    ('faq', 'can-i-use-special-character-in-smart-hospital'),
]

CATEGORY_BLURB = {
    'getting-started': 'Installation, updates, licensing and first-run setup.',
    'setup-configuration': 'Master data: patient fields, charges, beds, print header/footer, front office.',
    'system-settings': 'Notification, SMS, e-mail, payment-method and general system configuration.',
    'common-issues-troubleshooting': 'Known problems and fixes (404s, login URLs, SQL modes, SSL, hosting moves).',
    'faq': 'Frequently asked questions about deployment, characters, LAN use and multi-hospital operation.',
    'reports': 'The report library — how to read and filter each report.',
    'finance': 'Income and expense entry.',
    'billing': 'Billing concepts, single-module billing and case-based billing.',
    'appointment': 'Booking, slot setup and online appointments.',
    'opd-out-patient': 'Out-patient visits, profiles and discharge.',
    'ipd-in-patient': 'Admissions, vitals, obstetric history, BMI, overview and discharge.',
    'pharmacy': 'Medicines, stock, bad stock, import and sale.',
    'pathology': 'Test setup, reports and payment.',
    'radiology': 'Study setup, reports and payment.',
    'blood-bank': 'Components, donors, issue and stock.',
    'ambulance': 'Vehicles, drivers and calls.',
    'front-office': 'Visitors, calls, postal dispatch and complaints.',
    'birth-death-record': 'Statutory birth and death registers.',
    'human-resource': 'Departments, designations, leave types, specialists, payroll and leaves.',
    'qr-code-attendance': 'QR/barcode attendance with auto-attendance options.',
    'duty-roster': 'Shifts, rosters and staff assignment.',
    'annual-calendar': 'Holidays, activities, vacations and the front-site calendar tab.',
    'multi-branch': 'Adding, editing, switching and reporting across branches.',
    'referral': 'Referral persons and commission payments.',
    'tpa-management': 'Insurance/TPA handling.',
    'messaging': 'Notice board, SMS, e-mail and patient credentials.',
    'two-factor-authentication': 'Google Authenticator based 2FA setup for superadmin and staff.',
    'whatsapp-messaging': 'WhatsApp Cloud API (Meta) and Twilio configuration, per-event enablement.',
    'survey-form': 'Building, publishing and filling survey forms.',
    'inventory': 'Items, stock, issue and return.',
    'download-center': 'Sharing documents and media.',
    'certificate': 'Certificates, patient and staff ID cards.',
    'front-cms': 'Website pages, banners, events, gallery and media manager.',
    'live-consultation': 'Zoom live consultations and live meetings.',
    'patient-panel': 'The patient self-service portal (dashboard, appointments, OPD/IPD, bills, reports).',
    'changelog': 'Version history for the app and its addons (Android app, 2FA, multi-branch, QR attendance, survey, WhatsApp).',
    'miscellaneous': 'Calendar, to-dos, chat and other utilities.',
}


HEADER_PATTERNS = (
    r'^#{1,5}\s+',                                  # article title (PDF prints its own heading)
    r'^_?\s*[A-Z][a-z]{2},\s+\d{1,2}\s+[A-Z][a-z]{2},\s+\d{4}',  # publication date
    r'^(\[[^\]]*\]\([^)]*\))+\s*$',            # bare link line (Articles / category)
    r'^_[^_]*_\s*·',                                # generated meta line
    r'^-{3,}\s*$',
    r'^\s*$',
)


def strip_header(md):
    """Drop the generated front-matter/navigation block and demote inner headings."""
    lines = md.split('\n')
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        if any(re.match(p, ln) for p in HEADER_PATTERNS) or 'vendor article:' in ln:
            i += 1
            continue
        break
    body = '\n'.join(lines[i:])
    body = re.sub(r'\n{3,}', '\n\n', body).strip()
    # inner headings are one level below the article heading printed by the PDF
    body = re.sub(r'(?m)^###\s+', '#### ', body)
    return body


NAV_JUNK = ('toggle navigation', 'home features', 'how it works', 'buy now', 'all rights reserved',
            'select category', 'articles faq')


def clean_cat_name(name):
    return re.sub(r'\s*\(\d+\)\s*$', '', (name or '').strip())


def clean_desc(desc):
    d = re.sub(r'\s+', ' ', (desc or '')).strip()
    if len(d) < 40 or any(j in d.lower() for j in NAV_JUNK):
        return ''
    return d


def find_article(cats, cat_slug, art_slug):
    for c in cats:
        if c['slug'] != cat_slug:
            continue
        for a in c['articles']:
            if a['slug'] == art_slug:
                return c, a
    # tolerate slug differences
    for c in cats:
        for a in c['articles']:
            if a['slug'] == art_slug:
                return c, a
    return None, None


def main():
    os.makedirs(BUILD, exist_ok=True)
    idx_path = os.path.join(LIB, 'index.json')
    if not os.path.exists(idx_path):
        print('no help-library index yet:', idx_path)
        return
    data = json.load(open(idx_path))
    cats = data.get('categories', [])
    total = sum(len(c['articles']) for c in cats)

    L = []
    A = L.append
    A('# Smart Hospital — Vendor Help Library (mirrored)')
    A('')
    A(f'> Complete offline mirror of the vendor knowledge base at **smart-hospital.in/articles** — '
      f'**{total} articles across {len(cats)} categories**, downloaded with their screenshots and converted to Markdown.')
    A('>')
    A('> Source: QDOCS help articles · downloaded for offline use and diffing. Original text and images remain '
      '© QDOCS; they are reproduced here as product documentation for internal use.')
    A('')
    A('| Category | Articles | What it covers |')
    A('|---|---|---|')
    for c in sorted(cats, key=lambda x: (-len(x['articles']), clean_cat_name(x['name']).lower())):
        blurb = CATEGORY_BLURB.get(c['slug'], '') or clean_desc(c.get('description', ''))[:110]
        A(f"| [{clean_cat_name(c['name'])}](help-library/{c['slug']}/_index.md) | {len(c['articles'])} | {blurb} |")
    A('')
    A('---')
    A('')
    for c in sorted(cats, key=lambda x: clean_cat_name(x['name']).lower()):
        blurb = CATEGORY_BLURB.get(c['slug'], '')
        A(f"## {clean_cat_name(c['name'])} ({len(c['articles'])})")
        A('')
        if blurb:
            A(blurb)
            A('')
        desc = clean_desc(c.get('description', ''))
        if desc and desc != blurb and len(desc) < 400:
            A(f"_{desc}_")
            A('')
        for a in sorted(c['articles'], key=lambda x: x['title'].lower()):
            date = f" · {a['date']}" if a.get('date') else ''
            # an article listed under several categories is only mirrored once - link to that copy
            target = a.get('file') or f"{c['slug']}/{a['slug']}.md"
            A(f"- [{a['title']}](help-library/{target}){date}")
        A('')
    A('---')
    A('')
    A(f'_Mirrored automatically by `tools/docs/fetch_help.py`. Refresh with that script in an environment that can reach '
      f'smart-hospital.in, then rebuild this index with `python3 tools/docs/build_help_library.py`._')
    A('')

    with open(os.path.join(DOCS, 'HELP-LIBRARY.md'), 'w') as f:
        f.write('\n'.join(L) + '\n')

    # what the PDF inlines
    selected = []
    for cat_slug, art_slug in SELECTED:
        c, a = find_article(cats, cat_slug, art_slug)
        if not a:
            continue
        md_path = os.path.join(LIB, c['slug'], a['slug'] + '.md')
        if not os.path.exists(md_path):
            continue
        md = open(md_path).read()
        md = strip_header(md)
        if len(md) < 60:
            continue
        selected.append({'category': c['name'], 'category_slug': c['slug'], 'title': a['title'],
                         'date': a.get('date', ''), 'source': a['url'], 'body': md})

    with open(os.path.join(BUILD, 'help.json'), 'w') as f:
        json.dump({'categories': [{'name': clean_cat_name(c['name']), 'slug': c['slug'], 'count': len(c['articles']),
                                   'blurb': CATEGORY_BLURB.get(c['slug'], ''), 'description': clean_desc(c.get('description', '')),
                                   'articles': [{'title': a['title'], 'slug': a['slug'], 'date': a.get('date', ''),
                                                 'file': a['file']} for a in sorted(c['articles'], key=lambda x: x['title'].lower())]}
                                  for c in sorted(cats, key=lambda x: x['name'].lower())],
                       'total': total, 'selected': selected}, f, indent=1)

    print(f'HELP-LIBRARY.md: {len(cats)} categories, {total} articles; inline selection = {len(selected)} articles')


if __name__ == '__main__':
    main()
