/* -----------------------------------------------------------------------------
 * Inventory and purchase (P3) — the store side of stock, next to the dispensary.
 *
 * The dispensary screen answers "may this patient have it?"; this module answers "is it on the shelf, is it in
 * date, and does the order that brings it arrive before the shelf runs out?". Four rules are the whole point,
 * and each is enforced rather than described:
 *
 *  1. **Nothing is received without a batch number and an expiry date.** A box on a shelf with no expiry is an
 *     unusable box, and a store that cannot say when it expires cannot say when to stop using it.
 *  2. **Expired stock is quarantined, not counted as available** — it shows on the batch list with its value so
 *     it is written off deliberately, by a person, with a reason.
 *  3. **Replenishment covers the lead time**, not today: the suggestion is cover for lead time plus three weeks,
 *     rounded up to whole packs, and it says which rule fired.
 *  4. **Counters and approvers are different people.** A stock-take variance above the threshold cannot be
 *     posted until an approver is named — the same segregation-of-duties rule as the billing discount.
 *
 * Stock numbers are synthetic and deterministic, like the rest of the preview: the rules are real, the boxes are
 * not.
 */

import {
  DRUGS,
  EXPIRY_WARN_DAYS,
  expiryState,
  generateBatches as generateDrugBatches,
  type Batch,
} from './pharmacy';

/* ------------------------------------------------------------------ helpers (kept local, like the other modules) */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shift = (dayIso: string, days: number): string => {
  const d = new Date(`${dayIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export const daysUntil = (dateIso: string, dayIso: string): number =>
  Math.round((new Date(`${dateIso}T00:00:00`).getTime() - new Date(`${dayIso}T00:00:00`).getTime()) / 86_400_000);

/* ------------------------------------------------------------------ stores and items */

export type StoreId = 'Main store' | 'OPD store' | 'Ward store' | 'Theatre store' | 'Laboratory store';
export const STORES: StoreId[] = ['Main store', 'OPD store', 'Ward store', 'Theatre store', 'Laboratory store'];

export type ItemCategory = 'Medicine' | 'Consumable' | 'Reagent';

export interface StockItem {
  id: string;
  name: string;
  generic: string;
  form: string;
  strength?: string;
  /** The unit the store counts in — a tablet, a vial, a piece. */
  unit: string;
  /** How many units one purchase pack holds, and what the pack is called on the order. */
  packSize: number;
  packUnit: string;
  category: ItemCategory;
  controlled: boolean;
  highAlert: boolean;
  /** 2–8 °C: cannot sit on a rack, and a broken fridge is an incident. */
  coldChain: boolean;
  store: StoreId;
  reorderLevel: number;
  reorderQuantity: number;
  leadTimeDays: number;
  /** Last purchase price per unit, in Taka. */
  lastCost: number;
  supplierId: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  leadTimeDays: number;
  terms: string;
  /** Free delivery above this order value, in Taka — which is why suggestions are rounded to whole packs. */
  minOrderValue: number;
  /** The rate the supplier's invoice carries; not a number this screen invents. */
  vatRate: number;
}

export interface InvBatch extends Batch {
  unitCost: number;
  store: StoreId;
}

/* Consumables are not in the formulary, but they are most of what the store moves: gloves, cannulas, reagents. */
const CONSUMABLES: Array<Pick<StockItem, 'id' | 'name' | 'generic' | 'form' | 'unit' | 'packSize' | 'packUnit' | 'category' | 'coldChain' | 'store' | 'supplierId'>> = [
  { id: 'gloves-m', name: 'Examination gloves (M)', generic: 'Nitrile examination glove', form: 'Box', unit: 'piece', packSize: 100, packUnit: 'box of 100', category: 'Consumable', coldChain: false, store: 'Main store', supplierId: 'medipro' },
  { id: 'syringe-5', name: 'Syringe 5 ml', generic: 'Disposable syringe with needle', form: 'Box', unit: 'piece', packSize: 100, packUnit: 'box of 100', category: 'Consumable', coldChain: false, store: 'Ward store', supplierId: 'medipro' },
  { id: 'cannula-22', name: 'IV cannula 22G', generic: 'Peripheral venous cannula', form: 'Box', unit: 'piece', packSize: 50, packUnit: 'box of 50', category: 'Consumable', coldChain: false, store: 'Ward store', supplierId: 'medipro' },
  { id: 'giving-set', name: 'IV giving set', generic: 'Infusion set with air inlet', form: 'Box', unit: 'piece', packSize: 25, packUnit: 'box of 25', category: 'Consumable', coldChain: false, store: 'Ward store', supplierId: 'medipro' },
  { id: 'iv-fluid-ns', name: 'Normal saline 0.9 % 500 ml', generic: 'Sodium chloride 0.9 % infusion', form: 'Bag', unit: 'bag', packSize: 20, packUnit: 'carton of 20', category: 'Consumable', coldChain: false, store: 'Ward store', supplierId: 'ibnsina' },
  { id: 'gauze', name: 'Gauze swab 10 × 10 cm', generic: 'Sterile gauze swab', form: 'Packet', unit: 'packet', packSize: 40, packUnit: 'packet of 40', category: 'Consumable', coldChain: false, store: 'Theatre store', supplierId: 'medipro' },
  { id: 'suture-20', name: 'Suture 2-0 silk', generic: 'Braided silk suture', form: 'Box', unit: 'piece', packSize: 12, packUnit: 'box of 12', category: 'Consumable', coldChain: false, store: 'Theatre store', supplierId: 'medipro' },
  { id: 'rdt-malaria', name: 'Malaria rapid test kit', generic: 'P. falciparum HRP-2 RDT', form: 'Kit', unit: 'test', packSize: 25, packUnit: 'box of 25 tests', category: 'Reagent', coldChain: true, store: 'Laboratory store', supplierId: 'labcare' },
  { id: 'edta-tube', name: 'Blood collection tube EDTA', generic: 'K2-EDTA vacutainer 2 ml', form: 'Box', unit: 'tube', packSize: 100, packUnit: 'box of 100', category: 'Reagent', coldChain: false, store: 'Laboratory store', supplierId: 'labcare' },
  { id: 'glucose-strip', name: 'Blood glucose strip', generic: 'Glucose dehydrogenase strip', form: 'Vial', unit: 'strip', packSize: 50, packUnit: 'vial of 50 strips', category: 'Reagent', coldChain: false, store: 'OPD store', supplierId: 'labcare' },
];

/** The store's item master: the formulary, plus what the formulary does not carry. */
export function inventoryItems(dayIso: string): StockItem[] {
  const rand = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 7) * 6151);

  const drugs: StockItem[] = DRUGS.map((drug) => {
    const packs: Array<[number, string, string]> = [
      [100, 'box of 100', 'Tablet'],
      [50, 'box of 50', 'Capsule'],
      [1, 'single unit', 'Vial'],
    ];
    const [, packUnit] = packs.find(([, , form]) => form === drug.form) ?? [1, 'single unit', drug.form];
    const packSize = drug.form === 'Tablet' || drug.form === 'Capsule' || drug.form === 'Dispersible tablet' ? 100 : drug.form === 'Sachet' ? 50 : drug.form === 'Inhaler' ? 1 : 10;
    const unit = drug.form === 'Tablet' || drug.form === 'Capsule' || drug.form === 'Dispersible tablet' ? 'tablet' : drug.form === 'Inhaler' ? 'inhaler' : drug.form === 'Sachet' ? 'sachet' : drug.form === 'Vial' ? 'vial' : 'ampoule';
    // Daily use from the retail price band: cheap tablets move, one inhaler lasts a while. Deterministic.
    const base = drug.controlled ? 40 : drug.highAlert ? 25 : drug.price < 5 ? 900 : drug.price < 100 ? 300 : 30;
    const reorderLevel = Math.round(base * (0.5 + rand() * 0.8));
    return {
      id: drug.id,
      name: `${drug.brand} ${drug.strength} ${drug.form}`,
      generic: drug.generic,
      form: drug.form,
      strength: drug.strength,
      unit,
      packSize,
      packUnit: packUnit === 'single unit' ? `${packSize} ${unit}s` : packUnit,
      category: 'Medicine',
      controlled: drug.controlled,
      highAlert: drug.highAlert,
      coldChain: drug.id === 'insulin-soluble' || drug.form === 'Inhaler',
      store: drug.form === 'Inhaler' || drug.id === 'insulin-soluble' ? 'OPD store' : drug.controlled ? 'Theatre store' : 'Main store',
      reorderLevel,
      reorderQuantity: Math.max(packSize, Math.round(reorderLevel * 2.5)),
      leadTimeDays: drug.id === 'insulin-soluble' ? 14 : drug.price > 200 ? 10 : 5,
      lastCost: Math.max(1, Math.round(drug.price * 0.62)),
      supplierId: drug.controlled ? 'incepta' : ['eskayef', 'square', 'beximco', 'incepta'][Math.floor(rand() * 4)],
    };
  });

  const consumables: StockItem[] = CONSUMABLES.map((c, i) => {
    const reorderLevel = Math.round((60 + rand() * 400) / (i % 3 === 0 ? 2 : 1));
    return {
      ...c,
      strength: undefined,
      controlled: false,
      highAlert: false,
      reorderLevel,
      reorderQuantity: Math.max(c.packSize, Math.round(reorderLevel * 3)),
      leadTimeDays: c.category === 'Reagent' ? 12 : 7,
      lastCost: Math.max(1, Math.round((c.category === 'Reagent' ? 55 : 9) * (0.6 + rand()))),
    };
  });

  return [...drugs, ...consumables];
}

export const SUPPLIERS: Supplier[] = [
  { id: 'eskayef', name: 'Eskayef Pharmaceuticals', contact: '01711-000-101 · orders@eskayef.example', leadTimeDays: 5, terms: '30 days from receipt', minOrderValue: 8_000, vatRate: 5 },
  { id: 'square', name: 'Square Pharmaceuticals', contact: '01711-000-102 · hospital.desk@square.example', leadTimeDays: 4, terms: '21 days from receipt', minOrderValue: 10_000, vatRate: 5 },
  { id: 'beximco', name: 'Beximco Pharma', contact: '01711-000-103 · supply@beximco.example', leadTimeDays: 6, terms: '30 days from receipt', minOrderValue: 8_000, vatRate: 5 },
  { id: 'incepta', name: 'Incepta Pharmaceuticals', contact: '01711-000-104 · tender@incepta.example', leadTimeDays: 9, terms: '45 days, controlled items need a licence copy', minOrderValue: 12_000, vatRate: 5 },
  { id: 'medipro', name: 'Medipro Surgicals', contact: '01811-000-205 · sales@medipro.example', leadTimeDays: 7, terms: 'Cash on delivery', minOrderValue: 5_000, vatRate: 15 },
  { id: 'labcare', name: 'LabCare Diagnostics', contact: '01911-000-311 · supply@labcare.example', leadTimeDays: 12, terms: 'Advance payment, cold chain on arrival', minOrderValue: 15_000, vatRate: 15 },
];

export const supplierById = (id: string): Supplier | undefined => SUPPLIERS.find((s) => s.id === id);

/* ------------------------------------------------------------------ batches */

/** Every batch in the hospital, drugs and consumables alike, with what it cost and where it sits. */
export function inventoryBatches(dayIso: string, items: StockItem[]): InvBatch[] {
  const rand = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 3) * 7919);

  const fromDrugs: InvBatch[] = generateDrugBatches(dayIso).map((b) => {
    const item = items.find((i) => i.id === b.drugId);
    return { ...b, unitCost: item?.lastCost ?? 10, store: item?.store ?? 'Main store' };
  });

  const consumableBatches: InvBatch[] = items
    .filter((i) => !DRUGS.some((d) => d.id === i.id))
    .flatMap((item) => {
      const count = 1 + Math.floor(rand() * 2);
      return Array.from({ length: count }, (_, i) => {
        const expiryOffset = Math.floor(rand() * 600) - 40;
        return {
          id: `${item.id}-C${i + 1}`,
          drugId: item.id,
          batchNo: `${item.id.slice(0, 3).toUpperCase()}-${String(5100 + Math.floor(rand() * 700)).padStart(4, '0')}`,
          expiry: shift(dayIso, expiryOffset),
          qty: Math.floor(rand() * (item.reorderLevel * 2.4)) + (rand() < 0.15 ? 0 : 10),
          location: item.coldChain ? `Fridge·${1 + Math.floor(rand() * 3)}` : `${rand() < 0.5 ? 'Rack B' : 'Rack C'}·${1 + Math.floor(rand() * 5)}`,
          supplier: supplierById(item.supplierId)?.name ?? 'Main store',
          unitCost: Math.round(item.lastCost * (0.92 + rand() * 0.18)),
          store: item.store,
        };
      });
    });

  /* Two batches deliberately run out this week and one is already past its date, so the screens that deal with
     both have something real to show. */
  const expiring = items.find((i) => i.id === 'ors') ?? items[0];
  const expired = items.find((i) => i.category === 'Reagent') ?? items[0];
  return [
    ...fromDrugs,
    ...consumableBatches,
    { id: `${expiring.id}-soon`, drugId: expiring.id, batchNo: 'ORS-4451', expiry: shift(dayIso, 19), qty: Math.max(20, expiring.packSize), location: 'Rack B·2', supplier: 'Square Pharmaceuticals', unitCost: expiring.lastCost, store: expiring.store },
    { id: `${expired.id}-past`, drugId: expired.id, batchNo: 'RDT-3980', expiry: shift(dayIso, -12), qty: 34, location: 'Fridge·1', supplier: 'LabCare Diagnostics', unitCost: expired.lastCost, store: expired.store },
  ];
}

/* ------------------------------------------------------------------ quantities and cover */

export const usableQty = (batches: InvBatch[], itemId: string, dayIso: string): number =>
  batches
    .filter((b) => b.drugId === itemId && expiryState(b.expiry, dayIso) !== 'expired')
    .reduce((sum, b) => sum + b.qty, 0);

export const quarantinedQty = (batches: InvBatch[], itemId: string, dayIso: string): number =>
  batches
    .filter((b) => b.drugId === itemId && expiryState(b.expiry, dayIso) === 'expired')
    .reduce((sum, b) => sum + b.qty, 0);

export const itemValue = (batches: InvBatch[], itemId: string): number =>
  batches.filter((b) => b.drugId === itemId).reduce((sum, b) => sum + b.qty * b.unitCost, 0);

export const stockValue = (batches: InvBatch[]): number =>
  batches.reduce((sum, b) => sum + b.qty * b.unitCost, 0);

/* ------------------------------------------------------------------ movements */

export type MovementKind =
  | 'Receipt'
  | 'Issued to ward'
  | 'Issued to theatre'
  | 'Issued to OPD'
  | 'Returned to store'
  | 'Transferred between stores'
  | 'Adjustment (stock take)'
  | 'Write-off (expired)'
  | 'Write-off (damaged)';

export interface StockMovement {
  id: string;
  at: string;
  itemId: string;
  batchNo: string;
  kind: MovementKind;
  /** Positive into the store, negative out of it. */
  qty: number;
  by: string;
  reference: string;
  note?: string;
}

export const movementTone: Record<MovementKind, 'success' | 'info' | 'warning' | 'critical' | 'neutral'> = {
  Receipt: 'success',
  'Issued to ward': 'info',
  'Issued to theatre': 'info',
  'Issued to OPD': 'info',
  'Returned to store': 'info',
  'Transferred between stores': 'neutral',
  'Adjustment (stock take)': 'warning',
  'Write-off (expired)': 'critical',
  'Write-off (damaged)': 'critical',
};

export function storeMovements(dayIso: string, items: StockItem[], batches: InvBatch[]): StockMovement[] {
  const rand = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 11) * 8837);
  const staff = ['R. Haque (store keeper)', 'M. Sultana (store keeper)', 'T. Islam (pharmacy aide)'];
  const out: StockMovement[] = [];
  let n = 0;

  const push = (m: Omit<StockMovement, 'id' | 'at'> & { dayOffset: number }) => {
    const { dayOffset, ...rest } = m;
    const hour = 9 + Math.floor(rand() * 8);
    out.push({ id: `MV-${String(++n).padStart(4, '0')}`, at: `${shift(dayIso, dayOffset)} ${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`, ...rest });
  };

  for (const item of items) {
    const itemBatches = batches.filter((b) => b.drugId === item.id);
    const batch = itemBatches[0];
    if (!batch) continue;
    /* Yesterday's receiving, today's issues, and an occasional return — enough that every row of the ledger can
       be traced to a document rather than to the mood of a generator. */
    push({ dayOffset: -1, itemId: item.id, batchNo: batch.batchNo, kind: 'Receipt', qty: item.packSize * (1 + Math.floor(rand() * 2)), by: staff[Math.floor(rand() * staff.length)], reference: `GRN-${shift(dayIso, -1).replace(/-/g, '')}-0${1 + Math.floor(rand() * 9)}` });
    push({ dayOffset: 0, itemId: item.id, batchNo: batch.batchNo, kind: item.store === 'Theatre store' ? 'Issued to theatre' : item.store === 'Laboratory store' ? 'Issued to OPD' : 'Issued to ward', qty: -(5 + Math.floor(rand() * Math.max(6, Math.round(item.reorderLevel / 6)))), by: staff[Math.floor(rand() * staff.length)], reference: `REQ-${shift(dayIso, 0).replace(/-/g, '')}-${String(100 + Math.floor(rand() * 90))}` });
    if (rand() < 0.25) {
      push({ dayOffset: 0, itemId: item.id, batchNo: batch.batchNo, kind: 'Returned to store', qty: 1 + Math.floor(rand() * 6), by: staff[Math.floor(rand() * staff.length)], reference: `RET-${shift(dayIso, 0).replace(/-/g, '')}-${String(10 + Math.floor(rand() * 40))}`, note: 'Unused from the ward trolley, seal intact' });
    }
  }

  /* The two documents that keep a store honest: a write-off and a count correction. */
  const expiredBatch = batches.find((b) => expiryState(b.expiry, dayIso) === 'expired');
  if (expiredBatch) {
    push({ dayOffset: 0, itemId: expiredBatch.drugId, batchNo: expiredBatch.batchNo, kind: 'Write-off (expired)', qty: -expiredBatch.qty, by: 'R. Haque (store keeper)', reference: `WO-${shift(dayIso, 0).replace(/-/g, '')}-01`, note: `Batch expired ${expiredBatch.expiry}, destroyed with a witness and recorded in the waste log` });
  }
  const counted = items[2];
  if (counted) {
    push({ dayOffset: 0, itemId: counted.id, batchNo: batches.find((b) => b.drugId === counted.id)?.batchNo ?? '—', kind: 'Adjustment (stock take)', qty: -3, by: 'M. Sultana (store keeper)', reference: 'ST-2024-11', note: 'Counted less than the system said; three units unaccounted for' });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Average daily issue over the last two weeks, in units — the number the cover and the suggestion use. */
export function issueRate(movements: StockMovement[], itemId: string, days = 14): number {
  const out = movements.filter((m) => m.itemId === itemId && m.qty < 0 && !m.kind.startsWith('Write-off'));
  const total = out.reduce((sum, m) => sum + Math.abs(m.qty), 0);
  return total / days;
}

/* ------------------------------------------------------------------ replenishment */

export interface ReorderSuggestion {
  item: StockItem;
  usable: number;
  quarantined: number;
  onOrder: number;
  perDay: number;
  coverDays: number | null;
  suggestedUnits: number;
  suggestedPacks: number;
  value: number;
  severity: 'critical' | 'warning' | 'info';
  /** Which rule put the item on this list — a list that cannot explain itself gets ignored. */
  reason: string;
}

/**
 * What to order, and why. An item qualifies when the usable quantity is at or below its reorder level, when it
 * is due to expire inside the lead time, or when it has no usable stock at all. The suggested quantity covers
 * the lead time plus three weeks of the item's own usage, rounded up to whole packs, and never less than the
 * quantity the item's record asks for.
 */
export function reorderSuggestions(
  items: StockItem[],
  batches: InvBatch[],
  movements: StockMovement[],
  purchaseOrders: PurchaseOrder[],
  dayIso: string,
): ReorderSuggestion[] {
  const out: ReorderSuggestion[] = [];
  for (const item of items) {
    const usable = usableQty(batches, item.id, dayIso);
    const quarantined = quarantinedQty(batches, item.id, dayIso);
    const onOrder = purchaseOrders
      .filter((po) => po.status === 'Sent' || po.status === 'Partially received')
      .flatMap((po) => po.lines)
      .filter((l) => l.itemId === item.id)
      .reduce((sum, l) => sum + (l.quantity - l.received), 0);
    const perDay = issueRate(movements, item.id);

    const stockout = usable === 0;
    const belowReorder = usable <= item.reorderLevel;
    const expiringInsideLead = batches.some(
      (b) => b.drugId === item.id && b.qty > 0 && expiryState(b.expiry, dayIso) !== 'expired' && daysUntil(b.expiry, dayIso) <= item.leadTimeDays,
    );
    if (!stockout && !belowReorder && !expiringInsideLead) continue;

    const coverUnits = perDay * (item.leadTimeDays + 21);
    const target = Math.max(item.reorderQuantity, coverUnits) - usable - onOrder * 0.5;
    const suggestedPacks = Math.max(1, Math.ceil(Math.max(target, 1) / item.packSize));
    const suggestedUnits = suggestedPacks * item.packSize;

    out.push({
      item,
      usable,
      quarantined,
      onOrder,
      perDay: Number(perDay.toFixed(1)),
      coverDays: perDay > 0 ? Math.floor(usable / perDay) : null,
      suggestedUnits,
      suggestedPacks,
      value: suggestedUnits * item.lastCost,
      severity: stockout ? 'critical' : belowReorder && usable < item.reorderLevel * 0.5 ? 'critical' : belowReorder ? 'warning' : 'info',
      reason: stockout
        ? 'No usable stock'
        : belowReorder
          ? `At or below the reorder level (${item.reorderLevel} ${item.unit})`
          : `Expires within the ${item.leadTimeDays}-day lead time`,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.usable - b.usable : a.severity === 'critical' ? -1 : 1));
}

export const expiringBatches = (batches: InvBatch[], dayIso: string, withinDays = EXPIRY_WARN_DAYS): InvBatch[] =>
  batches
    .filter((b) => b.qty > 0 && expiryState(b.expiry, dayIso) !== 'expired' && daysUntil(b.expiry, dayIso) <= withinDays)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));

/* ------------------------------------------------------------------ purchase orders */

export type PoStatus = 'Draft' | 'Sent' | 'Partially received' | 'Received' | 'Cancelled';

export interface PoLine {
  itemId: string;
  /** Ordered in units; the sheet shows packs as well, because that is what arrives. */
  quantity: number;
  /** Units already accepted against this line. */
  received: number;
  unitCost: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  createdAt: string;
  expectedAt: string;
  status: PoStatus;
  lines: PoLine[];
  raisedBy: string;
  /** Required when a purchase order is cancelled. */
  cancelReason?: string;
  sentAt?: string;
  note?: string;
}

export interface GoodsReceiptLine {
  itemId: string;
  batchNo: string;
  expiry: string;
  quantity: number;
  unitCost: number;
  rejected: boolean;
  rejectReason?: string;
}

export interface GoodsReceipt {
  id: string;
  poId: string;
  at: string;
  by: string;
  lines: GoodsReceiptLine[];
  varianceNote?: string;
  witness?: string;
}

export interface StockCount {
  itemId: string;
  systemQty: number;
  countedQty: number | null;
  storer: string;
}

export function poSubtotal(po: PurchaseOrder): number {
  return po.lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
}

export function poTotals(po: PurchaseOrder): { subtotal: number; vat: number; total: number; vatRate: number } {
  const subtotal = poSubtotal(po);
  const vatRate = supplierById(po.supplierId)?.vatRate ?? 5;
  const vat = Math.round((subtotal * vatRate) / 100);
  return { subtotal, vat, total: subtotal + vat, vatRate };
}

export const orderUnits = (po: PurchaseOrder): number => po.lines.reduce((sum, l) => sum + l.quantity, 0);
export const outstandingLines = (po: PurchaseOrder): PoLine[] => po.lines.filter((l) => l.received < l.quantity);

/** A purchase order is only received against when there is something left to receive. */
export const awaitingReceipt = (pos: PurchaseOrder[]): PurchaseOrder[] =>
  pos.filter((po) => (po.status === 'Sent' || po.status === 'Partially received') && outstandingLines(po).length > 0);

/* ------------------------------------------------------------------ the day's inventory */

export interface InventoryDay {
  dayIso: string;
  items: StockItem[];
  batches: InvBatch[];
  movements: StockMovement[];
  purchaseOrders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  stockTake: StockCount[];
}

export function generateInventory(dayIso: string): InventoryDay {
  const items = inventoryItems(dayIso);
  const batches = inventoryBatches(dayIso, items);
  const rand = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 17) * 3571);
  const suggestions = reorderSuggestions(items, batches, storeMovements(dayIso, items, batches), [], dayIso);
  const bySupplier = (id: string) => items.filter((i) => i.supplierId === id);

  const line = (itemId: string, packs: number): PoLine => {
    const item = items.find((i) => i.id === itemId) ?? items[0];
    return { itemId, quantity: packs * item.packSize, received: 0, unitCost: item.lastCost };
  };

  const purchaseOrders: PurchaseOrder[] = [
    {
      id: `PO-${shift(dayIso, -6).replace(/-/g, '')}-01`,
      supplierId: 'eskayef',
      createdAt: shift(dayIso, -6),
      expectedAt: shift(dayIso, -1),
      status: 'Received',
      raisedBy: 'N. Ahmed (store manager)',
      sentAt: `${shift(dayIso, -6)} 10:20`,
      lines: bySupplier('eskayef').slice(0, 4).map((i) => ({ ...line(i.id, 2), received: 2 * i.packSize })),
    },
    {
      id: `PO-${shift(dayIso, -4).replace(/-/g, '')}-02`,
      supplierId: 'square',
      createdAt: shift(dayIso, -4),
      expectedAt: shift(dayIso, -1),
      status: 'Partially received',
      raisedBy: 'N. Ahmed (store manager)',
      sentAt: `${shift(dayIso, -4)} 15:05`,
      note: 'One line short: the supplier confirmed 300 of 400 units and will send the balance next week.',
      lines: bySupplier('square').slice(0, 5).map((i, idx) => ({ ...line(i.id, 3), received: idx === 0 ? 3 * i.packSize - 100 : 3 * i.packSize })),
    },
    {
      id: `PO-${shift(dayIso, -2).replace(/-/g, '')}-03`,
      supplierId: 'medipro',
      createdAt: shift(dayIso, -2),
      expectedAt: shift(dayIso, 5),
      status: 'Sent',
      raisedBy: 'M. Sultana (store keeper)',
      sentAt: `${shift(dayIso, -2)} 09:40`,
      lines: bySupplier('medipro').slice(0, 3).map((i) => line(i.id, 4)),
    },
    {
      id: `PO-${shift(dayIso, -1).replace(/-/g, '')}-04`,
      supplierId: 'labcare',
      createdAt: shift(dayIso, -1),
      expectedAt: shift(dayIso, 11),
      status: 'Sent',
      raisedBy: 'N. Ahmed (store manager)',
      sentAt: `${shift(dayIso, -1)} 11:15`,
      note: 'Cold chain on arrival: the laboratory accepts into the fridge and signs the temperature log.',
      lines: bySupplier('labcare').slice(0, 3).map((i) => line(i.id, 2)),
    },
    {
      id: `PO-${dayIso.replace(/-/g, '')}-05`,
      supplierId: 'incepta',
      createdAt: dayIso,
      expectedAt: shift(dayIso, 9),
      status: 'Draft',
      raisedBy: 'M. Sultana (store keeper)',
      lines: bySupplier('incepta').slice(0, 3).map((i) => line(i.id, 1)),
      note: 'Controlled items: licence copy and the signed indent go with the order.',
    },
    {
      id: `PO-${dayIso.replace(/-/g, '')}-06`,
      supplierId: 'beximco',
      createdAt: dayIso,
      expectedAt: shift(dayIso, 6),
      status: 'Draft',
      raisedBy: 'M. Sultana (store keeper)',
      lines: suggestions.filter((s) => s.item.supplierId === 'beximco').slice(0, 4).map((s) => line(s.item.id, s.suggestedPacks)),
    },
    {
      id: `PO-${shift(dayIso, -9).replace(/-/g, '')}-07`,
      supplierId: 'incepta',
      createdAt: shift(dayIso, -9),
      expectedAt: shift(dayIso, 0),
      status: 'Cancelled',
      raisedBy: 'N. Ahmed (store manager)',
      cancelReason: 'Supplier could not confirm the batch numbers before the tender closed',
      lines: bySupplier('incepta').slice(0, 2).map((i) => line(i.id, 2)),
    },
  ];

  const receipts: GoodsReceipt[] = [
    {
      id: `GRN-${shift(dayIso, -1).replace(/-/g, '')}-01`,
      poId: purchaseOrders[0].id,
      at: `${shift(dayIso, -1)} 09:15`,
      by: 'R. Haque (store keeper)',
      lines: purchaseOrders[0].lines.map((l, i) => ({
        itemId: l.itemId,
        batchNo: batches.find((b) => b.drugId === l.itemId)?.batchNo ?? `RCV-${1000 + i}`,
        expiry: shift(dayIso, 400 + i * 55),
        quantity: l.received,
        unitCost: l.unitCost,
        rejected: false,
      })),
      varianceNote: 'Delivered a day late; quantities matched the order exactly.',
    },
  ];

  const stockTake: StockCount[] = items.slice(0, 12).map((item, i) => {
    const systemQty = usableQty(batches, item.id, dayIso);
    /* Three deliberate variances: one small, one past the threshold, one with the shelf empty. */
    const countedQty = i === 4 ? systemQty - 3 : i === 7 ? Math.max(0, Math.round(systemQty * 0.86)) : i === 9 ? 0 : systemQty;
    return { itemId: item.id, systemQty, countedQty, storer: i % 2 === 0 ? 'M. Sultana (store keeper)' : 'R. Haque (store keeper)' };
  });

  return { dayIso, items, batches, movements: storeMovements(dayIso, items, batches), purchaseOrders, receipts, stockTake };
}

/* ------------------------------------------------------------------ counts, for the screens and the policy */

/** A variance is a finding, not a rounding error: past this, it needs a written reason and an approver. */
export const STOCK_VARIANCE_PCT = 2;
export const STOCK_VARIANCE_UNITS = 10;
export const needsApproval = (systemQty: number, countedQty: number): boolean => {
  const diff = Math.abs(systemQty - countedQty);
  if (diff === 0) return false;
  return diff > STOCK_VARIANCE_UNITS || (systemQty > 0 && (diff / systemQty) * 100 > STOCK_VARIANCE_PCT);
};

export const RECEIPT_REJECT_REASONS = [
  'Expiry too short for the shelf',
  'Batch number does not match the delivery note',
  'Cold chain broken on arrival',
  'Damaged packaging',
  'Quantity short of the delivery note',
];

export const VARIANCE_REASONS = [
  'Counted again, the earlier count was wrong',
  'Issued against a requisition that was not entered',
  'Breakage not yet written off',
  'Returned to the supplier but not recorded',
  'Under investigation — no explanation yet',
];
