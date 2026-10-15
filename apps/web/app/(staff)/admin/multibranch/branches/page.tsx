'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Panel, SafetyBanner, SelectField, Sheet, TextField, cx, useToast } from '@dizi/ui';
import { Info, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  BRANCHES,
  BRANCH_PROFILES,
  BRANCH_RULES,
  BRANCH_SETTING_DIFFS,
  branchSettingByKey,
  profileOf,
  type BranchId,
  type BranchSettingRow,
} from '@/lib/branches';

/* Multi Branch › Settings (P7) — what differs between the branches on purpose.
 *
 * An override is a promise that a branch is different, and every promise here comes with the clause that justifies
 * it. The screen is therefore a diff table rather than a settings form: the eleven rows that differ, and — the
 * part that matters — a note beside each one saying why a difference is allowed, and a row (VAT) that exists
 * precisely to show where it is not.
 *
 * A change is written through the branch settings operation, which is online-only: the value decides what a
 * counter prints and what a patient is told, and two branches reading different versions of the same promise is
 * the failure this screen exists to prevent.
 */

export default function MultiBranchSettingsPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<BranchSettingRow | null>(null);
  const [branch, setBranch] = useState<BranchId>('Main Campus');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [viewing, setViewing] = useState<BranchSettingRow | null>(null);

  const current = (row: BranchSettingRow, b: BranchId) => overrides[`${row.key}:${b}`] ?? row.values[b];
  const overridden = useMemo(() => Object.keys(overrides).length, [overrides]);

  const open = (row: BranchSettingRow, b: BranchId) => {
    setEditing(row);
    setBranch(b);
    setValue(current(row, b));
    setReason('');
  };

  const save = () => {
    if (!editing) return;
    if (!value.trim()) {
      push({ title: 'A branch value cannot be empty', description: 'An empty override is a screen that prints nothing where a promise should be, and the counter has no way to tell the difference.', tone: 'critical' });
      return;
    }
    if (!reason.trim()) {
      push({ title: 'A branch override needs a reason', description: 'The reason is printed on the row. It is what the next administrator reads when they consider whether the branch is still different, and it is what stops an override nobody can explain.', tone: 'critical' });
      return;
    }
    setOverrides((o) => ({ ...o, [`${editing.key}:${branch}`]: value.trim() }));
    const outcome = queueWrite(`${branch}: ${editing.label} → ${value.trim()} — ${reason.trim()}`, {
      id: 'updateBranchSetting',
      recordId: `${branch}:${editing.key}`,
      fields: { branch, key: editing.key, value: value.trim(), reason: reason.trim(), readBy: editing.readBy },
    });
    setEditing(null);
    push({
      title: outcome.queued ? `${editing.label} changed for ${branch}` : `${editing.label} not changed on this device`,
      description: outcome.queued
        ? `${editing.readBy} Every one of those reads the branch’s own value, and the change reaches them when the queue drains.`
        : `A branch setting is read by counters and prints, and the branch settings operation is online-only${outcome.because ? `: ${outcome.because}` : ''}.`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="multibranch-settings"
        subtitle={`${BRANCH_SETTING_DIFFS.length} rows differ between the branches · ${overridden} changed in this session · the rest of the settings are hospital-wide.`}
        actions={
          <>
            <Link href="/admin/multibranch">
              <Button variant="ghost">Back to the console</Button>
            </Link>
            <Link href="/admin/multibranch/report">
              <Button variant="ghost">Branch report</Button>
            </Link>
          </>
        }
        waiting="Everything that is not on this screen is hospital-wide on purpose. A price or a policy that differs without a reason is a complaint at a counter about what the other branch does."
      />

      <AdminSiblings screenId="multibranch-settings" />

      <Panel title="The differences, branch by branch" actions={<span className="text-xs text-text-secondary">{BRANCH_SETTING_DIFFS.length} rows · click a value to change it</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                <th className="py-1">Setting</th>
                {BRANCHES.map((b) => (
                  <th key={b} className="py-1">{profileOf(b).short}</th>
                ))}
                <th className="py-1">Why it is allowed to differ</th>
              </tr>
            </thead>
            <tbody>
              {BRANCH_SETTING_DIFFS.map((row) => (
                <tr key={row.key} className="border-b border-border-subtle/60 align-top">
                  <td className="py-1.5 pr-2">
                    <span className="font-medium text-text-primary">{row.label}</span>
                    <span className="block font-numeric text-xs text-text-tertiary">{row.key}</span>
                  </td>
                  {BRANCHES.map((b) => {
                    const changed = overrides[`${row.key}:${b}`] !== undefined;
                    const same = BRANCHES.every((x) => current(row, x) === current(row, b));
                    return (
                      <td key={b} className="py-1.5 pr-2">
                        <button
                          type="button"
                          onClick={() => open(row, b)}
                          className={cx(
                            'w-full rounded-sm border px-2 py-1 text-left text-xs',
                            changed ? 'border-brand-500 bg-brand-50' : same ? 'border-border-subtle bg-surface-sunken' : 'border-border-subtle hover:bg-surface-sunken',
                          )}
                        >
                          {current(row, b)}
                          {changed && <span className="block text-[10px] text-brand-700">changed, not yet saved to the server</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="py-1.5 text-xs text-text-secondary">
                    {row.because}
                    <button type="button" className="ml-1 underline" onClick={() => setViewing(row)}>
                      Who reads it
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="The same everywhere, and shown here on purpose" actions={<span className="text-xs text-text-secondary">a diff screen that only shows diffs hides this</span>}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>· <span className="font-medium text-text-primary">VAT on services</span> — the same at all three branches. It is the first thing an audit asks about, so the screen shows it as a row instead of leaving its absence to be noticed.</li>
          <li>· <span className="font-medium text-text-primary">Print header and footer</span> — authored once, at the hospital level. Twelve templates with twelve headers is how a branch prints two addresses and one of them is wrong.</li>
          <li>· <span className="font-medium text-text-primary">Clinical record structure</span> — a discharge summary written at Mirpur is the same document as one written at Main Campus, because a patient may be read at either.</li>
          <li>· <span className="font-medium text-text-primary">Drug catalogue and prices that come with it</span> — one catalogue, one strength, one name. A branch-specific drug list is how a prescription stops being dispensable at the branch next door.</li>
          <li>· <span className="font-medium text-text-primary">Duplicate rules</span> — one set, hospital-wide: a patient registered at Uttara and admitted at Main Campus is one patient, and two rule sets would make that a matter of which counter they reached.</li>
        </ul>
      </Panel>

      <Panel title="The branches themselves" actions={<span className="text-xs text-text-secondary">{BRANCH_PROFILES.length} sites</span>}>
        <ListView
          id="branch-profiles"
          caption="Branch profiles"
          rows={BRANCH_PROFILES}
          rowId={(p) => p.id}
          emptyLabel="No branches configured."
          columns={[
            { key: 'id', header: 'Branch', render: (p) => (<span><span className="font-medium">{p.id}</span><span className="block text-xs text-text-tertiary">{p.address}</span></span>) },
            { key: 'opened', header: 'Opened', width: '8rem', numeric: true },
            { key: 'beds', header: 'Beds', width: '6.5rem', align: 'right', numeric: true, render: (p) => String(p.beds) },
            { key: 'establishment', header: 'Own payroll', width: '9rem', align: 'right', numeric: true, render: (p) => `${p.establishment}` },
            { key: 'seconded', header: 'Seconded in', width: '9rem', align: 'right', hideBelow: 'md', numeric: true, render: (p) => (p.seconded ? String(p.seconded) : '—') },
            { key: 'services', header: 'Services on site', hideBelow: 'lg', render: (p) => p.services.join(' · ') },
            { key: 'licence', header: 'Licence', width: '11rem', hideBelow: 'lg', render: (p) => (<span className="text-xs">{p.licence.number}<span className="block text-text-tertiary">to {p.licence.expires}</span></span>) },
          ]}
        />
      </Panel>

      <Panel title="Why the console allows a difference at all" actions={<span className="text-xs text-text-secondary">{BRANCH_RULES.length} rules</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {BRANCH_RULES.map((rule) => (
            <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
              </p>
              <p className="text-text-secondary">{rule.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ---------------------------------------------------------------------------------- change one value */}
      <Sheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.label} — ${branch}` : 'Branch setting'}
        description={editing ? editing.because : undefined}
        width="md"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-text-secondary">{editing ? `Read by: ${editing.readBy}` : ''}</span>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!value.trim() || !reason.trim()}>Save for {profileOf(branch).short}</Button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-3">
            <SafetyBanner severity="warning" title="A branch override is a promise to one branch’s patients">
              {editing.readBy} {editing.because} Changing it for {branch} leaves the other branches as they are, and the row prints the reason beside the value.
            </SafetyBanner>

            <SelectField label="Branch" name="override-branch" value={branch} onChange={(e) => { const b = e.target.value as BranchId; setBranch(b); setValue(current(editing, b)); }} options={BRANCHES.map((b) => ({ value: b, label: b }))} hint="Which site this value applies to. There is no “all branches” here: a value that is the same everywhere belongs in the hospital-wide setting." />

            <TextField label="Value" name="override-value" value={value} onChange={(e) => setValue(e.target.value)} hint="What the branch prints, opens or tells a patient. Left as it is, the row keeps the hospital-wide value." />

            <div className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm">
              <p className="text-xs text-text-secondary">The three branches would then read:</p>
              <ul className="mt-1 space-y-1">
                {BRANCHES.map((b) => (
                  <li key={b} className={cx('flex items-baseline justify-between gap-2', b === branch ? 'font-medium text-text-primary' : 'text-text-secondary')}>
                    <span>{profileOf(b).short}</span>
                    <span className="text-xs">{b === branch ? value.trim() || '—' : current(editing, b)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <TextField label="Reason for the difference" name="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} hint="Printed on the row, and kept in the setting’s history: “Mirpur keeps evening clinics because that is what it was built for.”" />

            <p className="flex items-start gap-1.5 text-xs text-text-tertiary">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> A branch setting is written through the branch settings operation and it is online-only: the value is read by counters, prints and the public page,
              and two devices holding different versions of the same promise is the failure this screen exists to prevent.
            </p>
          </div>
        )}
      </Sheet>

      {/* --------------------------------------------------------------------------------------- who reads it */}
      <Sheet open={Boolean(viewing)} onClose={() => setViewing(null)} title={viewing ? `${viewing.label} — who reads it` : 'Who reads it'} width="md">
        {viewing && (
          <div className="space-y-3 text-sm">
            <p className="text-text-primary">{viewing.readBy}</p>
            <p className="text-text-secondary">{viewing.because}</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              {[
                ['Key', viewing.key],
                ['Scope', 'branch — a per-branch override of a hospital-wide default'],
                ['Values', BRANCHES.map((b) => `${profileOf(b).short}: ${current(viewing, b)}`).join(' · ')],
                ['Same at every branch?', BRANCHES.every((x) => current(viewing, x) === current(viewing, BRANCHES[0])) ? 'yes — shown here on purpose' : 'no — the reason is on the row'],
                ['Written by', 'Hospital admin, through the branch settings operation'],
                ['Read by', 'Every screen and counter named above, including the printed documents'],
              ].map(([label, val]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-medium">{val}</dd>
                </div>
              ))}
            </dl>
            <SafetyBanner severity="warning" title="Changing this changes what a patient is told">
              The screen shows the three values side by side before the save for that reason: a branch that opens at a different hour is fine, and a branch that prints a different
              promise on a receipt is a complaint with the hospital’s name at the top of it.
            </SafetyBanner>
            <p className="text-xs text-text-tertiary">
              {branchSettingByKey(viewing.key) ? `Set for ${BRANCHES.length} branches as of ${day}.` : ''} The setting’s history keeps who changed it, what it was and the reason given.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
