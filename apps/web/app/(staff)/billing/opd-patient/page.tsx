import { OpdPatientView } from '@/components/OpdPatientView';
import { todayIso } from '@/lib/appointments';

/* The OPD patient view: the page is a thin server wrapper so `?mrn=` can open an account directly from a receipt
 * or a bill, and the interactive part stays a client component. Opened without a parameter it shows the first
 * patient in the register, because an empty screen at a counter is a screen nobody uses.
 */
export default async function OpdPatientPage({ searchParams }: { searchParams: Promise<{ mrn?: string }> }) {
  const { mrn } = await searchParams;
  return <OpdPatientView initialMrn={mrn} day={todayIso()} />;
}
