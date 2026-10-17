/* -----------------------------------------------------------------------------
 * Pharmacy sale returns and credit notes — legacy screen 013.
 *
 * A return is where a pharmacy either keeps its stock safe or quietly poisons the next patient, so the rules are
 * written down and the screen enforces them:
 *
 *  - **Seven days, with the bill.** No bill number, no return. The bill is what proves the medicine came from here
 *    and that it has been stored somewhere else since.
 *  - **Sealed and unopened only.** A strip that has been out of its box has been in somebody's kitchen.
 *  - **Cold chain items are not returnable once they have left.** A vaccine that has been in a car for two hours is
 *    not stock, whatever its expiry date says.
 *  - **A controlled medicine is never returned to stock.** It is destroyed, with a witness and a reason, and the
 *    register records both — because “it went back on the shelf” is how a controlled substance stops being counted.
 *  - **Nothing goes back on the shelf without a decision.** A returned unit goes to quarantine, and a named person
 *    either restocks it or writes it off with a reason.
 *  - **The credit note goes where the money went.** Cash to cash, mobile wallet to the same wallet — and a return
 *    against a bill the payer covered goes back to the payer, not to the patient's pocket.
 *
 * Preview: the bills and dispenses are the same synthetic ones the pharmacy queue uses. Nothing survives a reload;
 * the rules do.
 */

import { money } from './billing';
import { generateBatches, generateDispenses, daysToExpiry, type Batch, type Dispense, type DispenseLine } from './pharmacy';
import { patients } from './mock';

/** The window in which a sale may be returned, with the bill. */
export const RETURN_WINDOW_DAYS = 7;
/** Below this shelf life the pharmacy does not restock a return, whatever else is right about it. */
export const MIN_REMAINING_SHELF_DAYS = 60;
/** Anything that has to stay cold: once it is out of the chain it is out for good. */
export const COLD_CHAIN_NOT_RETURNABLE = true;

export type ReturnCondition = 'Sealed, unopened' | 'Opened or loose' | 'Damaged' | 'Cold chain broken' | 'Expired on return';

export const RETURN_CONDITIONS: Array<{ id: ReturnCondition; restock: boolean; because: string }> = [
  { id: 'Sealed, unopened', restock: true, because: 'In its original sealed pack, with the batch number readable: this is the only condition that may go back on the shelf.' },
  { id: 'Opened or loose', restock: false, because: 'Out of its pack: nobody can vouch for how it was stored, so it is written off rather than restocked.' },
  { id: 'Damaged', restock: false, because: 'Damaged packs are written off with a reason and, when it matters, an incident note to the supplier.' },
  { id: 'Cold chain broken', restock: false, because: 'A cold-chain item that has been out of a fridge cannot be put back into the chain, even if it feels cold.' },
  { id: 'Expired on return', restock: false, because: 'Expired on the way back: destroyed under the standing procedure, with a witness.' },
];

export const RETURN_REASONS = [
  'Prescription changed by the doctor after dispensing',
  'Patient discharged early / treatment stopped',
  'Wrong brand handed over at the counter',
  'Patient reported an adverse reaction',
  'Dose changed — a different strength required',
  'Duplicate prescription found at the counter',
  'Patient did not require the full quantity',
  'Product recalled or withdrawn by the supplier',
];

export interface ReturnLineDraft {
  lineId: string;
  drugId: string;
  name: string;
  batchNo: string;
  dispensedQty: number;
  returnQty: number;
  unitPrice: number;
  condition: ReturnCondition;
  controlled: boolean;
}

export interface ReturnCheck {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  /** What will happen to the stock if the return goes ahead. */
  restock: boolean;
  credit: number;
}

/** The whole return, checked before it is recorded: bill window, quantity, condition, cold chain, controlled. */
export function checkReturn(dispense: Dispense, line: ReturnLineDraft, dayIso: string): ReturnCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const daysSince = dispense.dispensedAt
    ? Math.round(((new Date(`${dayIso}T12:00:00`).getTime() - new Date(dispense.dispensedAt).getTime()) / 86_400_000) * 10) / 10
    : undefined;

  if (!dispense.dispensedAt) blockers.push('This prescription has not been dispensed yet — there is nothing to return.');
  if (daysSince !== undefined && daysSince > RETURN_WINDOW_DAYS) {
    blockers.push(`Dispensed ${daysSince} days ago: the window is ${RETURN_WINDOW_DAYS} days, because after that nobody can vouch for how the medicine was stored.`);
  }
  if (line.returnQty <= 0) blockers.push('A return of zero units is not a return.');
  if (line.returnQty > line.dispensedQty) blockers.push(`Only ${line.dispensedQty} unit(s) were dispensed on this line; ${line.returnQty} cannot come back.`);
  if (line.controlled) {
    blockers.push('A controlled medicine is never returned to stock. It is destroyed with a witness and a reason, and the destruction is recorded in the controlled register.');
  }

  const condition = RETURN_CONDITIONS.find((c) => c.id === line.condition)!;
  if (!condition.restock) warnings.push(condition.because);
  if (/cold|insulin|vaccine/i.test(`${line.name}`) && COLD_CHAIN_NOT_RETURNABLE) {
    warnings.push('Cold-chain line: it is quarantine then write-off, not restock.');
  }

  const restock = condition.restock && !line.controlled && !/cold|insulin|vaccine/i.test(line.name);
  const credit = line.returnQty * line.unitPrice;

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    restock,
    credit,
  };
}

export interface SaleReturn {
  id: string;
  creditNote: string;
  dispenseId: string;
  rxNumber: string;
  mrn: string;
  patientName: string;
  at: string;
  lines: Array<{ name: string; batchNo: string; qty: number; credit: number; restocked: boolean; condition: ReturnCondition }>;
  reason: string;
  creditedTo: 'Patient' | 'Payer';
  method: string;
  approvedBy: string;
  /** Set when anything was written off rather than restocked: who witnessed it and why. */
  destruction?: { qty: number; witnessedBy: string; because: string };
  total: number;
}

/** Today's dispensed prescriptions that are still inside the return window. */
export function returnableDispenses(dayIso: string): Dispense[] {
  const batches = generateBatches(dayIso);
  return generateDispenses(dayIso, batches).filter((d) => d.status === 'Dispensed' || d.status === 'Partially dispensed');
}

/** Turn a dispensed line into the draft the counter works on. */
export function draftLine(line: DispenseLine, batch?: Batch): ReturnLineDraft {
  return {
    lineId: line.id,
    drugId: line.drug.id,
    name: `${line.drug.brand} ${line.drug.strength}`,
    batchNo: batch?.batchNo ?? '—',
    dispensedQty: line.qty,
    returnQty: line.qty,
    unitPrice: line.drug.price,
    condition: line.drug.controlled ? 'Opened or loose' : 'Sealed, unopened',
    controlled: line.drug.controlled,
  };
}

export const RETURN_RULES: Array<{ title: string; because: string }> = [
  { title: `${RETURN_WINDOW_DAYS} days, with the bill`, because: 'The bill proves the medicine came from here and that it has been somewhere else since. Without it, a return is a donation and the pharmacy cannot account for the stock.' },
  { title: 'Sealed and unopened only', because: 'A strip out of its box has been in somebody’s kitchen. The batch number must still be readable, because that is what the quarantine decision is made on.' },
  { title: 'Cold chain does not come back', because: 'A vaccine or an insulin pen that has been out of the fridge is written off, not restocked. It is the one rule where the money does not matter.' },
  { title: 'A controlled medicine is destroyed, never returned', because: 'It goes to the register with a witness and a reason. A controlled substance that quietly returns to the shelf is a controlled substance that stops being counted.' },
  { title: 'Nothing is restocked without a decision', because: 'A returned unit goes to quarantine and a named person either puts it back or writes it off. The default is not “shelf”.' },
  { title: 'The credit goes where the money came from', because: 'Cash to cash, wallet to the same wallet, and a payer-covered line back to the payer — a refund to the wrong party is a loss with two explanations.' },
  { title: `${MIN_REMAINING_SHELF_DAYS} days of shelf life to restock`, because: 'A return with less life left than that may be given to the very patient who returns it next week. Restocking it is just moving the expiry.' },
];

/** The register of returns for the day, from the same generator, so the screen has history to read. */
export function returnRegister(dayIso: string): SaleReturn[] {
  const dispensed = returnableDispenses(dayIso);
  return dispensed.slice(1, 4).map((d, i) => {
    const line = d.lines[0];
    const qty = Math.max(1, Math.min(4, Math.round(line.qty / 4)));
    const restocked = i === 0;
    return {
      id: `RET-${4200 + i}`,
      creditNote: `CN-${dayIso.slice(2, 4)}${dayIso.slice(5, 7)}-${6100 + i * 3}`,
      dispenseId: d.id,
      rxNumber: d.rxNumber,
      mrn: d.patient.mrn,
      patientName: d.patient.name,
      at: `${dayIso}T${String(10 + i).padStart(2, '0')}:20`,
      lines: [{
        name: `${line.drug.brand} ${line.drug.strength}`,
        batchNo: generateBatches(dayIso).find((b) => b.id === line.batchId)?.batchNo ?? '—',
        qty,
        credit: qty * line.drug.price,
        restocked,
        condition: restocked ? 'Sealed, unopened' : 'Opened or loose',
      }],
      reason: RETURN_REASONS[i === 0 ? 0 : i === 1 ? 3 : 5],
      creditedTo: 'Patient',
      method: i === 2 ? 'bKash' : 'Cash',
      approvedBy: 'Pharmacist in-charge',
      ...(restocked ? {} : { destruction: { qty, witnessedBy: 'Staff nurse M. Akter', because: 'Out of its pack: write-off rather than restock, recorded in the stock ledger.' } }),
      total: qty * line.drug.price,
    };
  });
}

/** Everything the register is worth, in one place. */
export function returnStats(dayIso: string, dispenses: Dispense[]) {
  const register = returnRegister(dayIso);
  const usable = generateBatches(dayIso).filter((b) => daysToExpiry(b.expiry, dayIso) > 0);
  const value = register.reduce((n, r) => n + r.total, 0);
  const writtenOff = register.reduce((n, r) => n + r.lines.filter((l) => !l.restocked).reduce((a, l) => a + l.credit, 0), 0);
  return {
    returnsToday: register.length,
    valueReturned: value,
    restocked: register.filter((r) => r.lines.every((l) => l.restocked)).length,
    writtenOff,
    destructions: register.filter((r) => r.destruction).length,
    dispensedToday: dispenses.filter((d) => d.status === 'Dispensed').length,
    returnRate: Math.round((register.length / (dispenses.length || 1)) * 1000) / 10,
    nearExpiryUnits: usable.filter((b) => daysToExpiry(b.expiry, dayIso) <= 90).reduce((n, b) => n + b.qty, 0),
  };
}

export const creditLabel = (amount: number): string => `${money(amount)} credited`;

/** A patient's own reason for bringing something back, in the words they use. */
export const PATIENT_REASONS = [
  'The doctor changed my medicine',
  'I was discharged before the course finished',
  'It made me feel unwell',
  'I was given the wrong box',
  'I have some left over',
];

export function patientOf(mrn: string) {
  return patients.find((p) => p.mrn === mrn);
}
