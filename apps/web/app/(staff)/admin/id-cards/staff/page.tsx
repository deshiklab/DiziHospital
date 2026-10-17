'use client';

import { IdCardScreen } from '@/components/IdCardScreen';

/* Staff ID Card (P8).
 *
 * The card a member of staff carries, and the register a gate, a fire roll call and a payroll all resolve back to.
 * Eleven columns: designation, department, employee number and photograph are on it because they are what a gate
 * checks, and the validity rule is the one this screen enforces hardest — a clinical card may not outlive the
 * professional licence it is the physical evidence of.
 */
export default function StaffIdCardPage() {
  return <IdCardScreen subject="staff" />;
}
