/* -----------------------------------------------------------------------------
 * Medicine search — the screen behind the counter, and the one a nurse uses at 02:00.
 *
 * The legacy screen (012) was a text box over a drug table. What makes this one useful is that it answers the four
 * questions a person at a counter actually has, in this order:
 *
 *   1. **Is it in the building?** Not “in stock” — which store, which batch, how many, and how long until it
 *      expires, because a box expiring next week is a different answer from one expiring next year.
 *   2. **What may I give instead?** A substitution is legal only within the same generic and strength; a different
 *      strength is a new prescription, and a controlled medicine is not substituted at all, by anybody.
 *   3. **Will it hurt this patient?** The allergy groups on the drug are checked against the patient’s recorded
 *      allergies, and the high-alert flag is shown before the dose is, not after.
 *   4. **What does it cost, and is it covered?** The retail price and the payer’s share, so the counter can say
 *      the number before the patient asks.
 *
 * Preview: the catalogue and the batches are the same synthetic ones the pharmacy module uses, so this screen can
 * never disagree with the dispensing queue. Nothing survives a reload; the rules do.
 */

import { DRUGS, EXPIRY_WARN_DAYS, generateBatches, daysToExpiry, stockOnHand, type Batch, type Drug } from './pharmacy';
import { inventoryItems, inventoryBatches, type InvBatch } from './inventory';
import { patients } from './mock';

export interface DrugHit {
  drug: Drug;
  /** Total usable units across every store, expired batches excluded. */
  onHand: number;
  byStore: Array<{ store: string; qty: number; nearestExpiry?: string; batches: number }>;
  nearestExpiry?: string;
  daysToNearest?: number;
  expiredQty: number;
  /** Where else it exists in the building: the store room counts even when the counter shelf is empty. */
  inMainStore: boolean;
}

const drugBatches = (dayIso: string, batches: Batch[]): Batch[] => batches;

/** Everything the search returns for a drug, including the stores it sits in. */
export function hit(drug: Drug, dayIso: string, batches: Batch[]): DrugHit {
  const mine = drugBatches(dayIso, batches).filter((b) => b.drugId === drug.id);
  const usable = mine.filter((b) => daysToExpiry(b.expiry, dayIso) >= 0);
  const stores = [...new Set(usable.map((b) => b.location))];
  const byStore = stores.map((store) => {
    const inStore = usable.filter((b) => b.location === store);
    const nearest = inStore.map((b) => b.expiry).sort()[0];
    return { store, qty: inStore.reduce((n, b) => n + b.qty, 0), ...(nearest ? { nearestExpiry: nearest } : {}), batches: inStore.length };
  }).sort((a, b) => b.qty - a.qty);

  const nearest = usable.map((b) => b.expiry).sort()[0];
  return {
    drug,
    onHand: usable.reduce((n, b) => n + b.qty, 0),
    byStore,
    ...(nearest ? { nearestExpiry: nearest, daysToNearest: daysToExpiry(nearest, dayIso) } : {}),
    expiredQty: mine.filter((b) => daysToExpiry(b.expiry, dayIso) < 0).reduce((n, b) => n + b.qty, 0),
    inMainStore: byStore.some((s) => /main/i.test(s.store) && s.qty > 0),
  };
}

export interface SearchFilters {
  inStockOnly: boolean;
  avoidAllergens: string[];
  hideControlled: boolean;
  store?: string;
  expiringWithinDays?: number;
}

/** The search itself: brand, generic, class, form and strength all match, because people search with all five. */
export function searchCatalogue(query: string, dayIso: string, filters: SearchFilters, batches: Batch[]): DrugHit[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  let hits = DRUGS.map((d) => hit(d, dayIso, batches));

  if (tokens.length > 0) {
    hits = hits.filter(({ drug }) => {
      const haystack = [drug.brand, drug.generic, drug.strength, drug.form, drug.klass, drug.id].join(' ').toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }
  if (filters.inStockOnly) hits = hits.filter((h) => h.onHand > 0);
  if (filters.hideControlled) hits = hits.filter((h) => !h.drug.controlled);
  if (filters.store) hits = hits.filter((h) => h.byStore.some((s) => s.store === filters.store));
  if (filters.expiringWithinDays !== undefined) hits = hits.filter((h) => (h.daysToNearest ?? 9999) <= filters.expiringWithinDays!);
  if (filters.avoidAllergens.length > 0) hits = hits.filter((h) => !allergyConflict(h.drug, filters.avoidAllergens).conflict);

  // In stock first, then cheapest, then alphabetically: the order a counter works in.
  return hits.sort((a, b) => Number(b.onHand > 0) - Number(a.onHand > 0) || a.drug.brand.localeCompare(b.drug.brand));
}

export interface AllergyCheck {
  conflict: boolean;
  tags: string[];
  message: string;
}

/** The allergy check, as a sentence rather than a flag. */
export function allergyConflict(drug: Drug, recorded: string[]): AllergyCheck {
  const tags = drug.allergenTags ?? [];
  if (tags.length === 0) return { conflict: false, tags, message: 'No recorded allergen group for this medicine.' };
  const text = recorded.join(' · ').toLowerCase();
  const hitTag = tags.find((t) => text.includes(t.toLowerCase()));
  if (hitTag) {
    return {
      conflict: true,
      tags,
      message: `${drug.brand} (${drug.generic}) belongs to the ${hitTag} group, which this patient has recorded as an allergy. Do not dispense without the prescriber changing the prescription.`,
    };
  }
  return { conflict: false, tags, message: `Contains the ${tags.join(' / ')} group — checked against this patient's record and clear.` };
}

export const SUBSTITUTION_RULES: Array<{ rule: string; because: string }> = [
  { rule: 'Same generic and same strength', because: 'A different brand of the identical molecule at the identical strength is a substitution, and a pharmacist may make it.' },
  { rule: 'A different strength is a new prescription', because: 'Halving a tablet is not the same as prescribing half the dose — the prescriber decides the dose, not the counter.' },
  { rule: 'A different route is a new prescription', because: 'Oral and injection are not interchangeable, however similar the molecule.' },
  { rule: 'A controlled medicine is never substituted', because: 'The prescription names it; substituting a controlled drug changes who is accountable for it, and that is the prescriber.' },
  { rule: 'A high-alert medicine is never substituted without a second check', because: 'Insulin, anticoagulants and opioids are where the decimal points matter. Two people read the prescription before it is handed over.' },
  { rule: 'The substitution is recorded on the line', because: '“Dispensed as” is a fact about the patient’s medication history. A silent swap makes the next prescriber’s decision wrong.' },
];

export interface Substitution {
  drug: Drug;
  onHand: number;
  pricePerUnit: number;
  priceDifference: number;
  legal: boolean;
  because: string;
}

/** Which alternatives the counter may offer, and why the others may not be offered. */
export function substitutionOptions(original: Drug, dayIso: string, batches: Batch[]): Substitution[] {
  const sameGeneric = DRUGS.filter((d) => d.generic === original.generic && d.id !== original.id);
  return sameGeneric
    .map((d) => {
      const stock = stockOnHand(batches, d.id);
      const sameStrength = d.strength === original.strength;
      const legal = sameStrength && !original.controlled && !d.controlled;
      const because = !sameStrength
        ? `A different strength (${d.strength} against ${original.strength}): the prescriber has to write it.`
        : original.controlled || d.controlled
          ? 'A controlled medicine: the prescription names it and only the prescriber may change it.'
          : `Same generic, same strength — a substitution the pharmacy may make and must record.`;
      return {
        drug: d,
        onHand: stock,
        pricePerUnit: d.price,
        priceDifference: d.price - original.price,
        legal,
        because,
      };
    })
    .sort((a, b) => Number(b.legal) - Number(a.legal) || a.pricePerUnit - b.pricePerUnit);
}

/* ------------------------------------------------------------------ the store's own view */

/** Consumables and reagents from the inventory module, so a search finds a cannula as readily as a tablet. */
export function searchStore(query: string, dayIso: string) {
  const q = query.trim().toLowerCase();
  const items = inventoryItems(dayIso);
  const batches = inventoryBatches(dayIso, items) as InvBatch[];
  return items
    .filter((i) => !q || [i.name, i.generic, i.category, i.id].join(' ').toLowerCase().includes(q))
    .map((i) => {
      const mine = batches.filter((b) => b.drugId === i.id);
      const usable = mine.filter((b) => daysToExpiry(b.expiry, dayIso) >= 0);
      return {
        item: i,
        onHand: usable.reduce((n, b) => n + b.qty, 0),
        stores: [...new Set(usable.map((b) => b.store))],
        nearestExpiry: usable.map((b) => b.expiry).sort()[0],
        coldChain: i.coldChain,
        controlled: (i as { controlled?: boolean }).controlled === true,
      };
    })
    .filter((r) => r.onHand > 0)
    .sort((a, b) => a.item.name.localeCompare(b.item.name))
    .slice(0, 8);
}

export const EXPIRY_WARNING_DAYS = EXPIRY_WARN_DAYS;

/** The patient picker's allergy line, straight off the register so the check is against the record, not a memory. */
export function allergiesOf(mrn: string): string[] {
  const patient = patients.find((p) => p.mrn === mrn);
  if (!patient || !patient.allergies) return [];
  return patient.allergies.split(/,|·/).map((s) => s.trim()).filter(Boolean);
}
