'use client';

import { IdCardScreen } from '@/components/IdCardScreen';

/* Patient ID Card (P8).
 *
 * The same register with seven columns, because a patient card is a different document: its identity is the MRN,
 * its Bangla name is what the holder and the gate read first, and it may be issued without a photograph — in which
 * case it prints an explicit “no photograph” block rather than a placeholder face.
 */
export default function PatientIdCardPage() {
  return <IdCardScreen subject="patient" />;
}
