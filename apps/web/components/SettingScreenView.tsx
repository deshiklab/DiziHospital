'use client';

import { useMemo, useState } from 'react';
import { Button, CheckboxField, FieldSection, Panel, SafetyBanner, SelectField, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { ListChecks, Save, ShieldAlert } from 'lucide-react';
import { checkSetting, type SettingField, type SettingScreen } from '@/lib/admin';
import { useShell } from '@/lib/shell';

/* Every settings screen in P7 is the same screen: a list of fields that each say what they decide and who reads
 * them, a save that refuses out-of-range values *before* it writes, and a rule list naming what breaks if the
 * setting is wrong.
 *
 * The save goes through `PUT /settings/{key}`, which is deliberately online-only in the contract: a setting change
 * is read by every other device in the branch, so a queued change that has not reached the server would leave two
 * branches greeting visitors under different rules. The screen says so instead of pretending to have saved.
 */

type Value = string | number | boolean;

export function SettingScreenView({ screen, extra }: { screen: SettingScreen; extra?: React.ReactNode }) {
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [draft, setDraft] = useState<Record<string, Value>>(() => Object.fromEntries(screen.fields.map((f) => [f.key, f.value])));
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const checks = useMemo(
    () => screen.fields.map((f) => ({ field: f, check: checkSetting(f, draft[f.key]) })),
    [screen.fields, draft],
  );
  const refusals = checks.filter((c) => !c.check.ok);
  const changed = screen.fields.filter((f) => draft[f.key] !== f.value);

  const set = (key: string, value: Value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  };

  const save = () => {
    if (refusals.length > 0) {
      push({ title: `Not saved — ${refusals.length} field(s) outside what this branch allows`, description: refusals[0].check.problem ?? '', tone: 'critical' });
      return;
    }
    if (changed.length === 0) {
      push({ title: 'Nothing to save', description: 'The screen still holds the values the branch is running on.', tone: 'info' });
      return;
    }
    const outcome = queueWrite(`${screen.title}: ${changed.map((f) => f.label).join(', ')}`, {
      id: 'savePlatformSetting',
      recordId: screen.key,
      fields: {
        key: screen.key,
        scope: screen.scope,
        // The sync engine carries scalars: a toggle goes over as the switch it is on the wire, not as a boolean the
        // server has to guess the encoding of.
        values: changed.map((f) => `${f.key}=${typeof draft[f.key] === 'boolean' ? (draft[f.key] ? 'on' : 'off') : draft[f.key]}`).join('; '),
      },
    });
    push({
      title: outcome.queued ? `${screen.title} saved` : `${screen.title} not saved on this device`,
      description: outcome.queued
        ? `The change is queued and reaches every reader of this setting when the queue drains.`
        : `This setting is online-only${outcome.because ? `: ${outcome.because}` : ''}. Every device in the branch reads it, so a change that has not reached the server would leave two screens obeying different rules.`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      {refusals.length > 0 && (
        <SafetyBanner severity="critical" title={`${refusals.length} field(s) this branch refuses`}>
          {refusals.map((c) => (
            <p key={c.field.key}>
              <span className="font-medium">{c.field.label}</span> — {c.check.problem}
            </p>
          ))}
        </SafetyBanner>
      )}

      <Panel
        title={screen.title}
        actions={
          <span className="text-xs text-text-secondary">
            {screen.scope === 'branch' ? 'Set for this branch' : 'Hospital-wide'} · {screen.fields.length} fields
          </span>
        }
      >
        <p className="mb-3 text-sm text-text-secondary">{screen.subtitle}</p>
        <div className="space-y-3">
          <FieldSection title="Fields" description={undefined}>
            {screen.fields.map((field) => {
              const value = draft[field.key];
              const failed = touched.has(field.key) && !checkSetting(field, value).ok;
              const error = failed ? checkSetting(field, value).problem : undefined;
              const name = `setting-${screen.key}-${field.key}`;
              if (field.kind === 'toggle') {
                return (
                  <CheckboxField
                    key={field.key}
                    name={name}
                    label={field.label}
                    checked={Boolean(value)}
                    onChange={(e) => set(field.key, e.target.checked)}
                    hint={`${field.hint} ${field.readBy}`}
                  />
                );
              }
              if (field.kind === 'select') {
                return (
                  <SelectField
                    key={field.key}
                    name={name}
                    label={field.label}
                    value={String(value)}
                    onChange={(e) => set(field.key, e.target.value)}
                    options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
                    hint={`${field.hint} ${field.readBy}`}
                    {...(error ? { error } : {})}
                  />
                );
              }
              if (field.kind === 'textarea') {
                return (
                  <TextAreaField
                    key={field.key}
                    name={name}
                    label={field.label}
                    value={String(value)}
                    onChange={(e) => set(field.key, e.target.value)}
                    hint={`${field.hint} ${field.readBy}`}
                    rows={2}
                    {...(error ? { error } : {})}
                  />
                );
              }
              return (
                <TextField
                  key={field.key}
                  name={name}
                  label={field.unit ? `${field.label} (${field.unit})` : field.label}
                  type={field.kind === 'number' || field.kind === 'money' ? 'number' : field.kind === 'time' ? 'time' : 'text'}
                  value={String(value)}
                  onChange={(e) => set(field.key, field.kind === 'number' || field.kind === 'money' ? Number(e.target.value) : e.target.value)}
                  hint={`${field.hint} ${field.readBy}`}
                  {...(error ? { error } : {})}
                />
              );
            })}
          </FieldSection>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-3">
          <span className="mr-auto text-xs text-text-secondary">
            {changed.length === 0 ? 'No change from what the branch is running on.' : `${changed.length} field(s) changed.`}
          </span>
          <Button variant="ghost" onClick={() => { setDraft(Object.fromEntries(screen.fields.map((f) => [f.key, f.value]))); setTouched(new Set()); }}>
            Reset to what is running
          </Button>
          <Button variant="primary" onClick={save} disabled={refusals.length > 0}>
            <Save className="size-4" aria-hidden /> Save setting
          </Button>
        </div>
      </Panel>

      {extra}

      <Panel title="What these settings decide" actions={<span className="text-xs text-text-secondary">{screen.rules.length} rules</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {screen.rules.map((rule) => (
            <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
              </p>
              <p className="text-text-secondary">{rule.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Who reads this, and what they see" actions={<span className="text-xs text-text-secondary">read-by, per field</span>}>
        <ul className="space-y-1 text-sm">
          {screen.fields.map((f) => (
            <li key={f.key} className="flex gap-2">
              <ListChecks className={cx('mt-0.5 size-3.5 shrink-0', draft[f.key] === f.value ? 'text-text-tertiary' : 'text-brand-600')} aria-hidden />
              <span>
                <span className="font-medium text-text-primary">{f.label}:</span> <span className="text-text-secondary">{f.readBy}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
