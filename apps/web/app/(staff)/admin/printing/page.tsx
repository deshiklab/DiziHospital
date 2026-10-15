'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Panel, SelectField, cx } from '@dizi/ui';
import { FileText, QrCode, Printer, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { SettingScreenView } from '@/components/SettingScreenView';
import { PRINT_RULES, PRINT_TEMPLATES, settingByKey, type PrintTemplate } from '@/lib/admin';
import { todayIso } from '@/lib/appointments';

/* Setup › Print Header Footer (P7) — the head and foot of every printed document.
 *
 * Twelve templates share one header. The legacy product let each one carry its own, which is how a branch ends up
 * with two addresses and one of them wrong, printed on a receipt a family keeps. So the header is authored once
 * here and previewed on a real specimen rather than described: the sample below is laid out at the paper size of
 * the template you pick, with the values the branch is running on.
 *
 * The preview is deliberately shown as the *saved* header rather than the draft on the screen above. A designer
 * previews a draft; a settings screen that previews unsaved text is one where somebody prints a document from a
 * preview that was never saved.
 */

const PAPER: Array<PrintTemplate['paper']> = ['A4', 'A5', 'Letter', 'Thermal 80 mm'];

export default function PrintHeaderFooterPage() {
  const day = todayIso();
  const setting = settingByKey('print.header');
  const field = (key: string, fallback = '') => String(setting?.fields.find((f) => f.key === key)?.value ?? fallback);
  const flag = (key: string) => String(setting?.fields.find((f) => f.key === key)?.value ?? 'true') === 'true';

  const [template, setTemplate] = useState<PrintTemplate['id']>('receipt');
  const [paper, setPaper] = useState<PrintTemplate['paper']>('Thermal 80 mm');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PRINT_TEMPLATES.filter((t) => !q || t.label.toLowerCase().includes(q) || t.prints.join(' ').toLowerCase().includes(q) || t.paper.toLowerCase().includes(q));
  }, [query]);

  const chosen = PRINT_TEMPLATES.find((t) => t.id === template) ?? PRINT_TEMPLATES[0];
  const width = paper === 'A4' || paper === 'Letter' ? 'max-w-md' : paper === 'A5' ? 'max-w-sm' : 'max-w-xs';

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="print-header-footer"
        subtitle={`Authored once, printed on ${PRINT_TEMPLATES.length} templates · previewed at the paper size of the document you pick.`}
        actions={
          <>
            <Link href="/admin/birthordeath">
              <Button variant="ghost">A record that prints</Button>
            </Link>
            <Link href="/admin/payroll">
              <Button variant="ghost">A payslip that prints</Button>
            </Link>
            <Link href="/admin/printing/designer">
              <Button variant="primary">Lay the templates out</Button>
            </Link>
          </>
        }
      />

      <AdminSiblings screenId="print-header-footer" />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="The specimen" actions={<SelectField label="Template" name="print-template" value={template} onChange={(e) => { const t = PRINT_TEMPLATES.find((x) => x.id === e.target.value); setTemplate(e.target.value); setPaper(t?.paper ?? 'A4'); }} options={PRINT_TEMPLATES.map((t) => ({ value: t.id, label: `${t.label} (${t.paper})` }))} />}>
          <p className="mb-2 text-xs text-text-secondary">
            {chosen.note} Printed on {paper}, carrying {chosen.prints.join(' · ').toLowerCase()}.
          </p>
          <div className={cx('mx-auto rounded-md border border-border-default bg-white p-4 text-text-primary shadow-sm', width)}>
            <div className="flex items-start justify-between gap-3 border-b border-dashed border-border-default pb-2">
              <div>
                <p className="text-sm font-bold">{field('hospitalName', 'Shaheed Suhrawardy General Hospital')}</p>
                <p className="text-xs">{field('branchLine', 'Main Campus · Mirpur Road, Dhaka 1207')}</p>
                <p className="text-xs">{field('headerNote', 'Emergency 16263 · Appointment 09612-345678')}</p>
              </div>
              {flag('showLogo') && paper !== 'Thermal 80 mm' && (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-border-default text-[10px] text-text-tertiary">logo</div>
              )}
            </div>

            <div className="py-2 text-xs">
              {template === 'receipt' && (
                <>
                  <p className="font-medium">Money receipt</p>
                  <p>Patient: Shirin Sultana · SH-102301</p>
                  <p>Invoice INV-2026-04417 · {day}</p>
                  <table className="mt-1 w-full">
                    <tbody>
                      <tr>
                        <td>Consultation</td>
                        <td className="text-right font-numeric">৳1,500.00</td>
                      </tr>
                      <tr>
                        <td>CBC, serum creatinine</td>
                        <td className="text-right font-numeric">৳950.00</td>
                      </tr>
                      <tr className="border-t border-border-default font-medium">
                        <td>Paid</td>
                        <td className="text-right font-numeric">৳2,450.00</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              {template === 'payslip' && (
                <>
                  <p className="font-medium">Payslip — October 2026</p>
                  <p>EMP-1002 S. Rahman · Senior Staff Nurse</p>
                  <table className="mt-1 w-full">
                    <tbody>
                      <tr>
                        <td>Basic + house rent + medical</td>
                        <td className="text-right font-numeric">৳1,13,178</td>
                      </tr>
                      <tr>
                        <td>Overtime 12.5 hours</td>
                        <td className="text-right font-numeric">৳4,417</td>
                      </tr>
                      <tr>
                        <td>Provident fund, insurance, tax</td>
                        <td className="text-right font-numeric">−৳16,209</td>
                      </tr>
                      <tr className="border-t border-border-default font-medium">
                        <td>Net</td>
                        <td className="text-right font-numeric">৳1,01,386</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              {template !== 'receipt' && template !== 'payslip' && (
                <>
                  <p className="font-medium">{chosen.label}</p>
                  <p>Shirin Sultana · SH-102301 · {day}</p>
                  <p className="mt-1 text-text-tertiary">{chosen.prints.join(' · ')}</p>
                  <p className="mt-1 text-text-tertiary">
                    The designer lays this document out. The header and footer on this screen are what it prints them with, at {paper}.
                  </p>
                </>
              )}
            </div>

            <div className="border-t border-dashed border-border-default pt-2 text-[10px] text-text-secondary">
              <p>{field('footerNote', 'This is a computer-generated document. Please bring it with you on your next visit.')}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span>Page 1 of 1 · {paper}</span>
                {flag('showQr') && (
                  <span className="flex items-center gap-1">
                    <QrCode className="size-3" aria-hidden /> verification code prints here
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-text-tertiary">
            Open <Link href={chosen.route} className="underline">{chosen.route}</Link> to print this document with a real record instead of the specimen. The specimen shows the values <span className="font-medium">the branch is running on</span>. Editing the fields above changes the draft and not this
            specimen, because a settings preview that shows unsaved text is how a document gets printed from a screen that was never saved.
          </p>
        </Panel>

        <Panel title="What every template prints" actions={<span className="text-xs text-text-secondary">{rows.length} of {PRINT_TEMPLATES.length}</span>}>
          <ListView
            id="print-templates"
            caption="Print templates"
            rows={rows}
            rowId={(t) => t.id}
            onRowClick={(t) => { setTemplate(t.id); setPaper(t.paper); }}
            quickSearch={{ value: query, onChange: setQuery, placeholder: 'Template, what it prints, or paper size' }}
            emptyLabel="No template matches that search."
            height="22rem"
            columns={[
              { key: 'label', header: 'Template', render: (t) => (<span><span className="font-medium">{t.label}</span><Link href={t.route} className="font-numeric block text-xs text-brand-700 underline">{t.route}</Link></span>) },
              { key: 'paper', header: 'Paper', width: '9.5rem', render: (t) => <span className="font-numeric">{t.paper}</span> },
              { key: 'prints', header: 'Prints', hideBelow: 'md', render: (t) => t.prints.join(' · ') },
              { key: 'authoredIn', header: 'Authored', width: '8rem', hideBelow: 'lg', render: (t) => t.authoredIn },
            ]}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            {PAPER.map((p) => (
              <span key={p} className={cx('rounded-full border px-2 py-0.5', p === chosen.paper ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border-subtle')}>
                {p} · {PRINT_TEMPLATES.filter((t) => t.paper === p).length}
              </span>
            ))}
            <span className="flex items-center gap-1 text-text-tertiary">
              <Printer className="size-3" aria-hidden /> {PRINT_TEMPLATES.filter((t) => t.authoredIn === 'designer').length} of {PRINT_TEMPLATES.length} are authored in the designer
            </span>
          </div>
        </Panel>
      </div>

      {setting && <SettingScreenView screen={setting} />}

      <Panel title="What the print service refuses" actions={<span className="text-xs text-text-secondary">{PRINT_RULES.length} rules</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {PRINT_RULES.map((rule) => (
            <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
              </p>
              <p className="text-text-secondary">{rule.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Authorship, and what is not in this build" actions={<FileText className="size-4 text-text-tertiary" aria-hidden />}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>· A template is either authored in the designer or coded, and the list says which — so a document that must not be re-laid-out by hand is not one anybody can.</li>
          <li>· The header and footer are branch settings: Uttara prints its own address under the same hospital name, and a receipt is traceable to the counter that issued it.</li>
          <li>· The designer itself is not in this build. What is here is the data every template reads and the specimen that proves it reads it, which is the part a settings screen owns.</li>
          <li>· Nothing on this screen prints. Printing happens from the document — a bill, a certificate, a payslip — and each of those links back to the template it uses.</li>
        </ul>
      </Panel>
    </div>
  );
}
