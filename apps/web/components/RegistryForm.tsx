'use client';

import { CheckboxField, FieldSection, SelectField, TextAreaField, TextField } from '@dizi/ui';
import { sectionsOf, type Draft, type RegistryField } from '@/lib/registry';

/* One renderer for both vital-events forms.
 *
 * Thirty-four fields on a birth record and eighteen on a death record is more than anybody types twice, and two
 * hand-written forms would drift from the metadata the harness checks against the screen map inside a month. So
 * the fields are data (`lib/registry.ts`) and this renders them: sections in the fields' own order, the right
 * primitive for each kind, and the hint under each one — because a register entry is filled in by a midwife at
 * three in the morning, and every field has to say what it wants without a manual.
 */

export function RegistryForm({ fields, draft, onChange }: { fields: RegistryField[]; draft: Draft; onChange: (key: string, value: string) => void }) {
  return (
    <div className="space-y-3">
      {sectionsOf(fields).map(({ section, fields: group }) => (
        <FieldSection key={section} title={section} description={undefined}>
          {group.map((field) => {
            const value = draft[field.key] ?? '';
            const name = `registry-${field.key}`;
            if (field.kind === 'toggle') {
              return (
                <CheckboxField
                  key={field.key}
                  name={name}
                  label={field.label}
                  checked={value === 'yes'}
                  onChange={(e) => onChange(field.key, e.target.checked ? 'yes' : 'no')}
                  hint={field.hint}
                />
              );
            }
            if (field.kind === 'select') {
              return (
                <SelectField
                  key={field.key}
                  name={name}
                  label={field.label}
                  value={value}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
                  hint={field.hint}
                  required={field.required}
                />
              );
            }
            if (field.kind === 'textarea') {
              return <TextAreaField key={field.key} name={name} label={field.label} value={value} onChange={(e) => onChange(field.key, e.target.value)} hint={field.hint} rows={2} />;
            }
            return (
              <TextField
                key={field.key}
                name={name}
                label={field.label}
                type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind === 'time' ? 'time' : 'text'}
                value={value}
                onChange={(e) => onChange(field.key, e.target.value)}
                hint={field.hint}
                required={field.required}
              />
            );
          })}
        </FieldSection>
      ))}
    </div>
  );
}
