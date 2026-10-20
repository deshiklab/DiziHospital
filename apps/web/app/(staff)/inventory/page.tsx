'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  DataGrid,
  KpiTile,
  Panel,
  SafetyBanner,
  Segmented,
  Sheet,
  Tabs,
  Tooltip,
  cx,
  useToast,
  type Column,
  type RowAction,
} from '@dizi/ui';
import { Printer, Trash2 } from 'lucide-react';
import {
  RECEIPT_REJECT_REASONS,
  STORES,
  STOCK_VARIANCE_PCT,
  STOCK_VARIANCE_UNITS,
  SUPPLIERS,
  VARIANCE_REASONS,
  awaitingReceipt,
  daysUntil,
  expiringBatches,
  generateInventory,
  itemValue,
  movementTone,
  needsApproval,
  poTotals,
  reorderSuggestions,
  stockValue,
  storeMovements,
  supplierById,
  usableQty,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type InventoryDay,
  type InvBatch,
  type MovementKind,
  type PoLine,
  type PoStatus,
  type PurchaseOrder,
  type StockCount,
  type StockItem,
  type StockMovement,
} from '@/lib/inventory';
import { expiryState } from '@/lib/pharmacy';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';

/* Stores and purchasing (legacy screens 060/061 replaced) — the P3 store side of stock.
 *
 * The dispensary screen asks "may this patient have it?". This one asks "is it on the shelf, is it in date, and
 * will the order that brings it arrive before the shelf runs out?" The four rules it enforces are at the top of
 * lib/inventory.ts; everything here exists to make them visible rather than to describe them.
 */

const INPUT = 'h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm';
const LABEL = 'text-xs text-text-secondary';
const stamp = (d = new Date()) =>
  `${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const money = (n: number) => `৳${n.toLocaleString('en-US')}`;

const chip = (tone: 'critical' | 'warning' | 'success' | 'info' | 'neutral', text: string) => (
  <span
    className={cx(
      'rounded-full px-2 py-0.5 text-xs',
      tone === 'critical' && 'bg-safety-critical/10 text-safety-critical',
      tone === 'warning' && 'bg-safety-warning/10 text-safety-warning',
      tone === 'success' && 'bg-safety-success/10 text-safety-success',
      tone === 'info' && 'bg-brand-50 text-brand-700',
      tone === 'neutral' && 'bg-surface-sunken text-text-secondary',
    )}
  >
    {text}
  </span>
);

const PO_TONE: Record<PoStatus, 'critical' | 'warning' | 'success' | 'info' | 'neutral'> = {
  Draft: 'neutral',
  Sent: 'info',
  'Partially received': 'warning',
  Received: 'success',
  Cancelled: 'critical',
};

export default function InventoryPage() {
  const { sync } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [day0, setDay0] = useState<InventoryDay>(() => generateInventory(day));
  const [tab, setTab] = useState('stock');
  const [category, setCategory] = useState<'all' | 'Medicine' | 'Consumable' | 'Reagent'>('all');
  const [store, setStore] = useState<'all' | (typeof STORES)[number]>('all');

  const [openPo, setOpenPo] = useState<PurchaseOrder | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [grnLines, setGrnLines] = useState<Record<string, GoodsReceiptLine>>({});
  const [grnWitness, setGrnWitness] = useState('');
  const [grnNote, setGrnNote] = useState('');

  const [writeOff, setWriteOff] = useState<InvBatch | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('Expired on the shelf');
  const [transfer, setTransfer] = useState<InvBatch | null>(null);
  const [transferTo, setTransferTo] = useState<(typeof STORES)[number]>('Ward store');
  const [transferQty, setTransferQty] = useState(0);
  const [cancelling, setCancelling] = useState<PurchaseOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [counts, setCounts] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(day0.stockTake.map((c) => [c.itemId, c.countedQty])),
  );
  const [countReasons, setCountReasons] = useState<Record<string, string>>({});
  const [approver, setApprover] = useState('');

  const byId = useMemo(() => new Map(day0.items.map((i) => [i.id, i])), [day0.items]);
  const suggestions = useMemo(
    () => reorderSuggestions(day0.items, day0.batches, day0.movements, day0.purchaseOrders, day),
    [day0, day],
  );
  const expiring = useMemo(() => expiringBatches(day0.batches, day), [day0.batches, day]);
  const quarantined = day0.batches.filter((b) => expiryState(b.expiry, day) === 'expired');
  const stockouts = day0.items.filter((i) => usableQty(day0.batches, i.id, day) === 0);
  const pending = awaitingReceipt(day0.purchaseOrders);

  const itemQty = (id: string) => usableQty(day0.batches, id, day);
  const onOrder = (id: string) =>
    day0.purchaseOrders
      .filter((po) => po.status === 'Sent' || po.status === 'Partially received')
      .flatMap((po) => po.lines)
      .filter((l) => l.itemId === id)
      .reduce((sum, l) => sum + (l.quantity - l.received), 0);

  const patchPo = (id: string, updater: (po: PurchaseOrder) => PurchaseOrder) =>
    setDay0((d) => ({ ...d, purchaseOrders: d.purchaseOrders.map((po) => (po.id === id ? updater(po) : po)) }));

  const filteredItems = day0.items.filter(
    (i) => (category === 'all' || i.category === category) && (store === 'all' || i.store === store),
  );
  const filteredBatches = day0.batches.filter(
    (b) => (category === 'all' || byId.get(b.drugId)?.category === category) && (store === 'all' || b.store === store),
  );

  const lineValue = (l: PoLine) => l.quantity * l.unitCost;

  /* ------------------------------------------------------------------------------- stock tab */
  const stockColumns: Array<Column<StockItem>> = [
    {
      key: 'name',
      header: 'Item',
      render: (i) => (
        <span className="flex flex-col">
          <span className="font-medium">{i.name}</span>
          <span className="text-xs text-text-tertiary">
            {i.generic} · {i.packUnit}
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: '8rem',
      render: (i) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-xs">{i.category}</span>
          <span className="flex gap-1">
            {i.controlled && chip('critical', 'Controlled')}
            {i.coldChain && chip('info', '2–8 °C')}
            {i.highAlert && chip('warning', 'High alert')}
          </span>
        </span>
      ),
    },
    { key: 'store', header: 'Store', hideBelow: 'md', render: (i) => <span className="text-xs">{i.store}</span> },
    {
      key: 'onHand',
      header: 'Usable',
      render: (i) => {
        const usable = itemQty(i.id);
        const bad = day0.batches.filter((b) => b.drugId === i.id && expiryState(b.expiry, day) === 'expired').reduce((s, b) => s + b.qty, 0);
        return (
          <span className="flex flex-col">
            <span className={cx('font-numeric', usable === 0 ? 'text-safety-critical' : usable <= i.reorderLevel ? 'text-safety-warning' : '')}>
              {usable.toLocaleString()} {i.unit}
            </span>
            {bad > 0 && <span className="font-numeric text-xs text-safety-critical">{bad} quarantined</span>}
          </span>
        );
      },
    },
    { key: 'reorderLevel', header: 'Reorder at', hideBelow: 'lg', render: (i) => <span className="font-numeric text-xs">{i.reorderLevel.toLocaleString()}</span> },
    {
      key: 'onOrder',
      header: 'On order',
      hideBelow: 'lg',
      render: (i) => {
        const n = onOrder(i.id);
        return n > 0 ? <span className="font-numeric text-xs text-brand-700">{n.toLocaleString()}</span> : <span className="text-xs text-text-tertiary">—</span>;
      },
    },
    {
      key: 'value',
      header: 'Value',
      hideBelow: 'md',
      render: (i) => <span className="font-numeric text-xs">{money(itemValue(day0.batches, i.id))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (i) => {
        const usable = itemQty(i.id);
        if (usable === 0) return chip('critical', 'Stock-out');
        if (usable <= i.reorderLevel) return chip('warning', 'Below reorder');
        const soon = day0.batches.some((b) => b.drugId === i.id && b.qty > 0 && expiryState(b.expiry, day) === 'expiring');
        return soon ? chip('info', 'Expiring soon') : chip('success', 'OK');
      },
    },
  ];

  const stockActions = (i: StockItem): RowAction<StockItem>[] => [
    {
      label: 'Raise a purchase order',
      onSelect: (item) => {
        const suggestion = suggestions.find((s) => s.item.id === item.id);
        const packs = suggestion?.suggestedPacks ?? Math.max(1, Math.ceil(item.reorderQuantity / item.packSize));
        const po: PurchaseOrder = {
          id: `PO-${day.replace(/-/g, '')}-${String(90 + day0.purchaseOrders.length).padStart(2, '0')}`,
          supplierId: item.supplierId,
          createdAt: day,
          expectedAt: day,
          status: 'Draft',
          raisedBy: 'You (store)',
          lines: [{ itemId: item.id, quantity: packs * item.packSize, received: 0, unitCost: item.lastCost }],
          note: 'Raised from the stock list; check the quantity against the suggestion before sending.',
        };
        setDay0((d) => ({ ...d, purchaseOrders: [po, ...d.purchaseOrders] }));
        push({ title: 'Draft order raised', description: `${supplierById(item.supplierId)?.name} · ${packs} × ${item.packUnit}`, tone: 'success' });
      },
    },
    { label: 'See the batches', onSelect: (item) => { setCategory('all'); setStore('all'); setTab('batches'); push({ title: `Batches for ${item.name}`, description: 'Filtered view — FEFO order, earliest expiry first', tone: 'info' }); } },
    { label: 'Transfer between stores', onSelect: () => setTab('batches') },
  ];

  const stockTab = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-text-secondary">
          {day0.items.length} items · {money(stockValue(day0.batches))} on the shelves · {stockouts.length} stock-outs ·{' '}
          {expiring.length} batch(es) expiring within 90 days
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            name="inv-category"
            label="Category"
            value={category}
            onChange={setCategory}
            options={[
              { value: 'all', label: 'All' },
              { value: 'Medicine', label: 'Medicines' },
              { value: 'Consumable', label: 'Consumables' },
              { value: 'Reagent', label: 'Reagents' },
            ]}
          />
          <Segmented
            name="inv-store"
            label="Store"
            value={store}
            onChange={setStore}
            options={[{ value: 'all', label: 'All stores' }, ...STORES.map((s) => ({ value: s, label: s.replace(' store', '') }))]}
          />
        </div>
      </div>
      <DataGrid<StockItem>
        id="inventory-stock"
        caption="Stock on hand"
        columns={stockColumns}
        rows={filteredItems}
        total={filteredItems.length}
        page={1}
        pageSize={50}
        rowId={(i) => i.id}
        height="30rem"
        quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Item, generic or supplier…' }}
        rowActions={stockActions}
        onRowClick={(row) => { setWriteOff(null); setTransfer(null); setTab('batches'); void row; }}
        exportFileName="stock-on-hand"
        printMeta={`Stock on hand · ${day} · Main Campus`}
        emptyLabel="No items in this filter."
      />
    </div>
  );

  /* ----------------------------------------------------------------------------- batches tab */
  const batchColumns: Array<Column<InvBatch>> = [
    { key: 'batchNo', header: 'Batch', width: '9rem', render: (b) => <span className="font-numeric text-xs">{b.batchNo}</span> },
    {
      key: 'item',
      header: 'Item',
      render: (b) => (
        <span className="flex flex-col">
          <span className="font-medium">{byId.get(b.drugId)?.name ?? b.drugId}</span>
          <span className="text-xs text-text-tertiary">{byId.get(b.drugId)?.packUnit}</span>
        </span>
      ),
    },
    {
      key: 'expiry',
      header: 'Expiry',
      render: (b) => {
        const state = expiryState(b.expiry, day);
        const days = daysUntil(b.expiry, day);
        return (
          <span className="flex flex-col gap-0.5">
            <span className="font-numeric text-sm">{b.expiry}</span>
            {state === 'expired'
              ? chip('critical', `Expired ${Math.abs(days)} days ago`)
              : state === 'expiring'
                ? chip('warning', `${days} days left`)
                : chip('success', 'In date')}
          </span>
        );
      },
    },
    { key: 'qty', header: 'Quantity', render: (b) => <span className={cx('font-numeric', b.qty === 0 && 'text-text-tertiary')}>{b.qty.toLocaleString()}</span> },
    { key: 'value', header: 'Value', hideBelow: 'md', render: (b) => <span className="font-numeric text-xs">{money(b.qty * b.unitCost)}</span> },
    { key: 'location', header: 'Location', hideBelow: 'md', render: (b) => <span className="text-xs">{b.location}</span> },
    { key: 'store', header: 'Store', hideBelow: 'lg', render: (b) => <span className="text-xs">{b.store}</span> },
    { key: 'supplier', header: 'Supplier', hideBelow: 'lg', render: (b) => <span className="text-xs">{b.supplier}</span> },
  ];

  const batchActions = (b: InvBatch): RowAction<InvBatch>[] => {
    const expired = expiryState(b.expiry, day) === 'expired';
    const list: RowAction<InvBatch>[] = [
      {
        label: expired ? 'Write off (expired)' : 'Write off (damaged)',
        danger: true,
        onSelect: (batch) => {
          setWriteOff(batch);
          setWriteOffReason(expired ? 'Expired on the shelf' : 'Damaged in the store');
        },
      },
      {
        label: 'Transfer to another store',
        separated: true,
        onSelect: (batch) => {
          setTransfer(batch);
          setTransferQty(batch.qty);
          setTransferTo(batch.store === 'Ward store' ? 'Theatre store' : 'Ward store');
        },
      },
      { label: 'Stock card (this batch)', onSelect: (batch) => push({ title: `Batch ${batch.batchNo}`, description: `${batch.location} · ${batch.qty} on hand · received from ${batch.supplier}`, tone: 'info' }) },
    ];
    return list;
  };

  const batchesTab = (
    <div className="flex flex-col gap-2">
      <SafetyBanner severity={quarantined.length > 0 ? 'warning' : 'success'} title={quarantined.length > 0 ? `${quarantined.length} batch(es) past their date are still on the shelves` : 'No expired stock on the shelves'}>
        Expired stock is quarantined: it is out of the usable quantity, it is excluded from every order
        suggestion, and it stays visible — with its value — until somebody writes it off and says why. Stock that
        quietly disappears is how a store loses money it cannot explain.
      </SafetyBanner>
      <DataGrid<InvBatch>
        id="inventory-batches"
        caption="Batches and expiry"
        columns={batchColumns}
        rows={filteredBatches}
        total={filteredBatches.length}
        page={1}
        pageSize={50}
        rowId={(b) => b.id}
        height="30rem"
        quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Batch number, item or supplier…' }}
        rowActions={batchActions}
        exportFileName="batches"
        printMeta={`Batches as of ${day} · FEFO order`}
        emptyLabel="No batches in this filter."
      />
    </div>
  );

  /* ----------------------------------------------------------------------------- reorder tab */
  const [picked, setPicked] = useState<string[]>([]);
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pickedSuggestions = suggestions.filter((s) => picked.includes(s.item.id));

  const reorderTab = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiTile
          label="Stock value"
          value={money(stockValue(day0.batches))}
          definition="Everything on the shelves at the last purchase price, quarantined batches included."
          asOf={day}
        />
        <KpiTile
          label="To replenish"
          value={String(suggestions.length)}
          definition="Items at or below their reorder level, or due to expire inside their lead time."
          asOf={day}
          footnote={`${stockouts.length} with no usable stock at all`}
        />
        <KpiTile
          label="Expiring within 90 days"
          value={String(expiring.length)}
          definition="Batches still in date but inside the expiry warning window."
          asOf={day}
          footnote={`${money(expiring.reduce((s, b) => s + b.qty * b.unitCost, 0))} at risk`}
        />
        <KpiTile
          label="Awaiting receipt"
          value={String(pending.length)}
          definition="Orders sent to a supplier with lines still outstanding."
          asOf={day}
        />
      </div>

      <SafetyBanner severity="info" title="What the suggestion covers">
        Lead time plus three weeks of the item&apos;s own usage, rounded up to whole packs, and never less than the
        quantity on the item record. Quantities already on order count, half — a supplier who is late is not a
        reason to order twice.
      </SafetyBanner>

      {suggestions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-sm text-text-tertiary">
          Every item is above its reorder level and in date.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-secondary">
              {picked.length === 0 ? 'Tick the lines to order, or raise them one at a time from the stock list.' : `${picked.length} line(s) selected · ${money(pickedSuggestions.reduce((s, x) => s + x.value, 0))}`}
            </span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPicked(suggestions.map((s) => s.item.id))}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked([])} disabled={picked.length === 0}>Clear</Button>
              <Button
                size="sm"
                variant="primary"
                disabled={picked.length === 0}
                onClick={() => {
                  const bySupplier = new Map<string, typeof pickedSuggestions>();
                  for (const s of pickedSuggestions) {
                    bySupplier.set(s.item.supplierId, [...(bySupplier.get(s.item.supplierId) ?? []), s]);
                  }
                  const raised: PurchaseOrder[] = [];
                  let n = 0;
                  for (const [supplierId, lines] of bySupplier) {
                    const po: PurchaseOrder = {
                      id: `PO-${day.replace(/-/g, '')}-${String(95 + day0.purchaseOrders.length + n).padStart(2, '0')}`,
                      supplierId,
                      createdAt: day,
                      expectedAt: day,
                      status: 'Draft',
                      raisedBy: 'You (store)',
                      lines: lines.map((s) => ({ itemId: s.item.id, quantity: s.suggestedUnits, received: 0, unitCost: s.item.lastCost })),
                      note: 'Raised from the replenishment list; the lead time is why it is this quantity.',
                    };
                    raised.push(po);
                    n += 1;
                  }
                  setDay0((d) => ({ ...d, purchaseOrders: [...raised, ...d.purchaseOrders] }));
                  setPicked([]);
                  setTab('purchase-orders');
                  push({
                    title: `${raised.length} draft order(s) raised`,
                    description: `One per supplier · ${pickedSuggestions.length} line(s), ${money(pickedSuggestions.reduce((s, x) => s + x.value, 0))} before tax`,
                    tone: 'success',
                  });
                }}
              >
                Raise {new Set(pickedSuggestions.map((s) => s.item.supplierId)).size || 0} draft order(s)
              </Button>
            </div>
          </div>

          <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
            {suggestions.map((s) => (
              <li key={s.item.id} className="flex flex-wrap items-center gap-3 p-2">
                <input
                  type="checkbox"
                  checked={picked.includes(s.item.id)}
                  onChange={() => togglePick(s.item.id)}
                  aria-label={`Order ${s.item.name}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{s.item.name}</span>
                  <span className="text-xs text-text-tertiary">
                    {supplierById(s.item.supplierId)?.name} · {s.item.packUnit} · lead time {s.item.leadTimeDays} days
                  </span>
                </span>
                {chip(s.severity, s.reason)}
                <span className="font-numeric ml-auto text-xs text-text-secondary">
                  {s.usable.toLocaleString()} on hand
                  {s.onOrder > 0 && ` · ${s.onOrder.toLocaleString()} on order`}
                  {s.coverDays !== null && ` · ${s.coverDays} days cover`}
                </span>
                <span className="font-numeric text-sm">
                  {s.suggestedPacks} × {s.item.packUnit} <span className="text-xs text-text-tertiary">= {s.suggestedUnits.toLocaleString()} {s.item.unit}</span>
                </span>
                <span className="font-numeric w-24 text-right">{money(s.value)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  /* ------------------------------------------------------------------- purchase orders tab */
  const poColumns: Array<Column<PurchaseOrder>> = [
    { key: 'id', header: 'Order', width: '11rem', render: (po) => <span className="font-numeric text-xs">{po.id}</span> },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (po) => (
        <span className="flex flex-col">
          <span className="font-medium">{supplierById(po.supplierId)?.name}</span>
          <span className="text-xs text-text-tertiary">{supplierById(po.supplierId)?.terms}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (po) => chip(PO_TONE[po.status], po.status) },
    { key: 'lines', header: 'Lines', hideBelow: 'md', render: (po) => <span className="font-numeric text-xs">{po.lines.length} · {po.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString()} units</span> },
    { key: 'expectedAt', header: 'Expected', hideBelow: 'md', render: (po) => <span className="font-numeric text-xs">{po.expectedAt}</span> },
    {
      key: 'total',
      header: 'Value',
      render: (po) => {
        const t = poTotals(po);
        return <span className="font-numeric text-sm">{money(t.total)}</span>;
      },
    },
  ];

  const poActions = (po: PurchaseOrder): RowAction<PurchaseOrder>[] => {
    const list: RowAction<PurchaseOrder>[] = [{ label: 'Open the order', onSelect: (row) => setOpenPo(row) }];
    if (po.status === 'Draft') {
      list.push({
        label: 'Mark as sent',
        onSelect: (row) => {
          patchPo(row.id, (p) => ({ ...p, status: 'Sent', sentAt: stamp() }));
          push({ title: `${row.id} sent`, description: `${supplierById(row.supplierId)?.name} · expectedin ${supplierById(row.supplierId)?.leadTimeDays} days`, tone: 'success' });
        },
      });
    }
    if (po.status === 'Sent' || po.status === 'Partially received') {
      list.push({ label: 'Receive against this order', onSelect: (row) => startReceiving(row) });
      list.push({ label: 'Print the order', onSelect: (row) => window.open(`/print/purchase-order?po=${row.id}`, '_blank', 'noopener') });
    }
    if (po.status === 'Received') {
      list.push({ label: 'Print the order', onSelect: (row) => window.open(`/print/purchase-order?po=${row.id}`, '_blank', 'noopener') });
    }
    if (po.status !== 'Received' && po.status !== 'Cancelled') {
      list.push({ label: 'Cancel the order', danger: true, separated: true, onSelect: (row) => { setCancelling(row); setCancelReason(''); } });
    }
    return list;
  };

  const openTotals = openPo ? poTotals(openPo) : null;

  const purchaseTab = (
    <div className="flex flex-col gap-2">
      {pending.length > 0 && (
        <SafetyBanner severity="info" title={`${pending.length} order(s) waiting to be received`}>
          Receiving needs a batch number and an expiry for every line — a box with no expiry is a box nobody can
          use. A quantity that does not match the delivery note has to be rejected line by line, with the reason,
          or the supplier's invoice will disagree with the store forever.
        </SafetyBanner>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => setTab('reorder')}>Go to replenishment</Button>
        <Tooltip content="A blank order is deliberately not offered: an order that starts from nothing ends up with whatever was in the catalogue, which is how a store fills up with what nobody uses.">
          <Button size="sm" variant="ghost">Raise from the stock list</Button>
        </Tooltip>
      </div>
      <DataGrid<PurchaseOrder>
        id="inventory-orders"
        caption="Purchase orders"
        columns={poColumns}
        rows={day0.purchaseOrders}
        total={day0.purchaseOrders.length}
        page={1}
        pageSize={25}
        rowId={(po) => po.id}
        height="28rem"
        quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Order number, supplier or status…' }}
        rowActions={poActions}
        onRowClick={(po) => setOpenPo(po)}
        exportFileName="purchase-orders"
        printMeta={`Purchase orders as of ${day}`}
        emptyLabel="No purchase orders."
      />
    </div>
  );

  /* --------------------------------------------------------------------------- movements tab */
  const [kindFilter, setKindFilter] = useState<'all' | MovementKind>('all');
  const movementColumns: Array<Column<StockMovement>> = [
    { key: 'at', header: 'When', width: '11rem', render: (m) => <span className="font-numeric text-xs">{m.at}</span> },
    { key: 'item', header: 'Item', render: (m) => <span className="text-sm">{byId.get(m.itemId)?.name ?? m.itemId}</span> },
    { key: 'batchNo', header: 'Batch', hideBelow: 'md', render: (m) => <span className="font-numeric text-xs">{m.batchNo}</span> },
    { key: 'kind', header: 'Movement', render: (m) => chip(movementTone[m.kind], m.kind) },
    {
      key: 'qty',
      header: 'Quantity',
      render: (m) => (
        <span className={cx('font-numeric', m.qty > 0 ? 'text-safety-success' : 'text-text-primary')}>
          {m.qty > 0 ? '+' : ''}
          {m.qty.toLocaleString()} {byId.get(m.itemId)?.unit}
        </span>
      ),
    },
    { key: 'by', header: 'By', hideBelow: 'lg', render: (m) => <span className="text-xs">{m.by}</span> },
    { key: 'reference', header: 'Reference', hideBelow: 'lg', render: (m) => <span className="font-numeric text-xs">{m.reference}</span> },
    { key: 'note', header: 'Note', hideBelow: 'xl', render: (m) => <span className="text-xs text-text-tertiary">{m.note ?? ''}</span> },
  ];

  const movementsTab = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-text-secondary">
          Every movement of every batch, in the order it happened, each one traceable to a document: a goods
          received note, a ward requisition, a count sheet or a write-off.
        </p>
        <div className="ml-auto">
          <Segmented
            name="inv-kind"
            label="Movement type"
            value={kindFilter}
            onChange={setKindFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'Receipt', label: 'Receipts' },
              { value: 'Issued to ward', label: 'Issues' },
              { value: 'Write-off (expired)', label: 'Write-offs' },
              { value: 'Adjustment (stock take)', label: 'Counts' },
            ]}
          />
        </div>
      </div>
      <DataGrid<StockMovement>
        id="inventory-movements"
        caption="Store ledger"
        columns={movementColumns}
        rows={kindFilter === 'all' ? day0.movements : day0.movements.filter((m) => m.kind === kindFilter)}
        total={day0.movements.length}
        page={1}
        pageSize={50}
        rowId={(m) => m.id}
        height="28rem"
        quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Item, batch, reference or person…' }}
        exportFileName="store-ledger"
        printMeta="Movements are append-only: a correction is a new movement, never an edit"
        emptyLabel="No movements of this type."
      />
    </div>
  );

  /* -------------------------------------------------------------------------- stock take tab */
  const countRows: Array<StockCount & { item: StockItem; variance: number; needsApproval: boolean; reason: string }> = day0.stockTake.map((c) => {
    const item = byId.get(c.itemId) as StockItem;
    const counted = counts[c.itemId] ?? null;
    const variance = counted === null ? 0 : counted - c.systemQty;
    return { ...c, item, variance, needsApproval: counted !== null && needsApproval(c.systemQty, counted), reason: countReasons[c.itemId] ?? '' };
  });
  const openVariances = countRows.filter((r) => r.variance !== 0);
  const blockers = countRows.filter((r) => r.needsApproval && (!r.reason || !approver || approver === r.storer));
  const countedAll = countRows.every((r) => counts[r.itemId] !== null && counts[r.itemId] !== undefined);

  const stockTakeTab = (
    <div className="flex flex-col gap-2">
      <SafetyBanner severity={openVariances.length > 0 ? 'warning' : 'success'} title={openVariances.length > 0 ? `${openVariances.length} variance(s) in this count sheet` : 'Every line agrees with the system'}>
        Rules: anything above {STOCK_VARIANCE_UNITS} units or {STOCK_VARIANCE_PCT} % needs a written reason, and the
        person who approves the sheet must not be the person who counted it. That is the same separation the
        billing desk uses for a discount, and for the same reason.
      </SafetyBanner>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Stock take count sheet</caption>
          <thead className="bg-surface-sunken text-xs text-text-secondary">
            <tr>
              <th scope="col" className="px-2 py-1.5">Item</th>
              <th scope="col" className="px-2 py-1.5 text-right">System</th>
              <th scope="col" className="px-2 py-1.5 text-right">Counted</th>
              <th scope="col" className="px-2 py-1.5 text-right">Variance</th>
              <th scope="col" className="px-2 py-1.5">Reason (required above the threshold)</th>
              <th scope="col" className="px-2 py-1.5">Counted by</th>
            </tr>
          </thead>
          <tbody>
            {countRows.map((r) => (
              <tr key={r.itemId} className="border-t border-border-subtle">
                <td className="px-2 py-1.5">
                  <span className="flex flex-col">
                    <span>{r.item.name}</span>
                    <span className="text-xs text-text-tertiary">{r.item.store} · {r.item.unit}</span>
                  </span>
                </td>
                <td className="font-numeric px-2 py-1.5 text-right">{r.systemQty.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    min={0}
                    value={counts[r.itemId] ?? ''}
                    onChange={(e) => setCounts((c) => ({ ...c, [r.itemId]: e.target.value === '' ? null : Number(e.target.value) }))}
                    className={cx(INPUT, 'w-24 text-right', r.needsApproval && 'border-safety-warning')}
                    aria-label={`Counted quantity for ${r.item.name}`}
                  />
                </td>
                <td className={cx('font-numeric px-2 py-1.5 text-right', r.variance !== 0 && (r.needsApproval ? 'text-safety-critical' : 'text-safety-warning'))}>
                  {r.variance > 0 ? '+' : ''}
                  {r.variance}
                  {r.systemQty > 0 && r.variance !== 0 && <span className="block text-[11px] text-text-tertiary">{((r.variance / r.systemQty) * 100).toFixed(1)}%</span>}
                </td>
                <td className="px-2 py-1.5">
                  {r.needsApproval ? (
                    <select
                      value={r.reason}
                      onChange={(e) => setCountReasons((c) => ({ ...c, [r.itemId]: e.target.value }))}
                      className={cx(INPUT, !r.reason && 'border-safety-critical')}
                      aria-label={`Reason for the variance on ${r.item.name}`}
                    >
                      <option value="">Choose the reason…</option>
                      {VARIANCE_REASONS.map((reason) => (
                        <option key={reason} value={reason}>{reason}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-text-tertiary">{r.variance === 0 ? 'Agrees with the system' : 'Within the threshold — no reason needed'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs">{r.storer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Approved by (must not be the counter)</span>
          <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="e.g. N. Ahmed (store manager)" className={cx(INPUT, 'w-72')} />
        </label>
        <Button
          variant="primary"
          disabled={!countedAll || blockers.length > 0}
          onClick={() => {
            const adjustments: StockMovement[] = openVariances.map((r, i) => ({
              id: `MV-ADJ-${String(i + 1).padStart(3, '0')}`,
              at: stamp(),
              itemId: r.itemId,
              batchNo: day0.batches.find((b) => b.drugId === r.itemId)?.batchNo ?? '—',
              kind: 'Adjustment (stock take)',
              qty: r.variance,
              by: r.storer,
              reference: `ST-${day.replace(/-/g, '')}`,
              note: `${r.reason || 'Within the threshold'} · approved by ${approver}`,
            }));
            setDay0((d) => ({
              ...d,
              movements: [...adjustments, ...d.movements],
              batches: d.batches.map((b) => {
                const row = openVariances.find((r) => r.itemId === b.drugId);
                if (!row) return b;
                const batchesForItem = d.batches.filter((x) => x.drugId === b.drugId);
                if (batchesForItem[0]?.id !== b.id) return b;
                return { ...b, qty: Math.max(0, b.qty + row.variance) };
              }),
            }));
            push({
              title: `Count sheet posted`,
              description: `${adjustments.length} adjustment(s) written to the ledger · approved by ${approver}`,
              tone: 'success',
            });
          }}
        >
          Post the adjustments
        </Button>
        <span className="text-xs text-text-tertiary">
          {blockers.length > 0
            ? `${blockers.length} line(s) still need a reason, or an approver who is not the counter.`
            : countedAll
              ? 'Ready to post: the sheet is complete.'
              : 'Count every line before posting.'}
        </span>
      </div>
    </div>
  );

  /* ------------------------------------------------------------------------------ the sheets */
  const startReceiving = (po: PurchaseOrder) => {
    const lines: Record<string, GoodsReceiptLine> = {};
    for (const l of po.lines.filter((x) => x.received < x.quantity)) {
      const item = byId.get(l.itemId) as StockItem;
      lines[l.itemId] = {
        itemId: l.itemId,
        batchNo: '',
        expiry: '',
        quantity: l.quantity - l.received,
        unitCost: l.unitCost,
        rejected: false,
      };
      void item;
    }
    setGrnLines(lines);
    setGrnWitness('');
    setGrnNote('');
    setReceiving(po);
  };

  const grnIssue = (lines: Record<string, GoodsReceiptLine>): string | null => {
    for (const l of Object.values(lines)) {
      const item = byId.get(l.itemId) as StockItem;
      if (l.rejected && !l.rejectReason) return `${item.name}: a rejection needs its reason.`;
      if (l.rejected) continue;
      if (!l.batchNo.trim()) return `${item.name}: a batch number is required — nothing is received without one.`;
      if (!l.expiry) return `${item.name}: an expiry date is required.`;
      if (endsBefore(l.expiry, day)) return `${item.name}: that batch is already expired (${l.expiry}).`;
      if (l.quantity <= 0) return `${item.name}: the received quantity must be more than zero.`;
      if (item.coldChain && !grnWitness.trim()) return `${item.name}: cold-chain items need the person who checked the temperature named.`;
    }
    return null;
  };

  const endsBefore = (dateIso: string, dayIso: string) => daysUntil(dateIso, dayIso) < 0;


  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Stores &amp; purchase</h1>
          <p className="text-sm text-text-secondary">
            {day0.items.length} items · {money(stockValue(day0.batches))} on hand · {suggestions.length} to replenish ·{' '}
            {pending.length} order(s) awaiting receipt
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pharmacy">
            <Button variant="ghost">Dispensary</Button>
          </Link>
          <Button variant="primary" onClick={() => setTab('reorder')}>
            Replenishment list
          </Button>
        </div>
      </div>

      <SafetyBanner severity="info" title="P3 module — preview screens, synthetic stock">
        The rules here are the ones the store will run on: batch and expiry on every receipt, expired stock
        quarantined and written off with a reason, replenishment that covers the lead time, and a count sheet that
        a second person approves. The items, batches, suppliers and money are synthetic.
      </SafetyBanner>

      {sync !== 'live' && (
        <SafetyBanner severity="warning" title="Working offline in the store">
          Receiving, issuing, transfers and the count sheet all continue on the hospital server. Sending an order to
          a supplier waits for the uplink — the draft is safe, and the queue drains when the connection returns.
        </SafetyBanner>
      )}

      {quarantined.length > 0 && (
        <SafetyBanner severity="critical" title={`${quarantined.length} expired batch(es) still on the shelf`}>
          {quarantined
            .slice(0, 3)
            .map((b) => `${byId.get(b.drugId)?.name ?? b.drugId} ${b.batchNo} (expired ${b.expiry})`)
            .join(' · ')}
          {' — write them off from the batches tab, with a witness.'}
        </SafetyBanner>
      )}

      <Tabs
        items={[
          { id: 'stock', label: 'Stock on hand', count: filteredItems.length },
          { id: 'batches', label: 'Batches & expiry', count: filteredBatches.length },
          { id: 'reorder', label: 'Replenishment', count: suggestions.length },
          { id: 'purchase-orders', label: 'Purchase orders', count: day0.purchaseOrders.length },
          { id: 'movements', label: 'Store ledger', count: day0.movements.length },
          { id: 'stock-take', label: 'Stock take', count: openVariances.length },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'stock' && stockTab}
        {tab === 'batches' && batchesTab}
        {tab === 'reorder' && reorderTab}
        {tab === 'purchase-orders' && purchaseTab}
        {tab === 'movements' && movementsTab}
        {tab === 'stock-take' && stockTakeTab}
      </Tabs>

      {/* ------------------------------------------------------------------- purchase order sheet */}
      <Sheet
        open={openPo !== null}
        onClose={() => setOpenPo(null)}
        title={openPo ? `${openPo.id} · ${supplierById(openPo.supplierId)?.name}` : ''}
        description={openPo ? `${openPo.status} · raised ${openPo.createdAt} by ${openPo.raisedBy}${openPo.sentAt ? ` · sent ${openPo.sentAt}` : ''}` : ''}
        width="xl"
        footer={
          openPo && (
            <div className="flex flex-wrap gap-2">
              {openPo.status === 'Draft' && (
                <Button
                  variant="primary"
                  onClick={() => {
                    patchPo(openPo.id, (p) => ({ ...p, status: 'Sent', sentAt: stamp() }));
                    push({ title: `${openPo.id} sent`, description: 'The supplier has the order; the store waits for delivery', tone: 'success' });
                    setOpenPo(null);
                  }}
                >
                  Mark as sent
                </Button>
              )}
              {(openPo.status === 'Sent' || openPo.status === 'Partially received') && (
                <Button variant="primary" onClick={() => startReceiving(openPo)}>Receive stock</Button>
              )}
              <Button variant="ghost" className="gap-1.5" onClick={() => window.open(`/print/purchase-order?po=${openPo.id}`, '_blank', 'noopener')}>
                <Printer className="size-3.5" aria-hidden />
                Print
              </Button>
              {openPo.status !== 'Received' && openPo.status !== 'Cancelled' && (
                <Button variant="ghost" className="text-safety-critical" onClick={() => { setCancelling(openPo); setCancelReason(''); }}>
                  <Trash2 className="size-3.5" aria-hidden />
                  Cancel
                </Button>
              )}
            </div>
          )
        }
      >
        {openPo && openTotals && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <span><span className="block text-xs text-text-secondary">Supplier</span>{supplierById(openPo.supplierId)?.name}</span>
              <span><span className="block text-xs text-text-secondary">Terms</span>{supplierById(openPo.supplierId)?.terms}</span>
              <span><span className="block text-xs text-text-secondary">Lead time</span>{supplierById(openPo.supplierId)?.leadTimeDays} days</span>
              <span><span className="block text-xs text-text-secondary">Expected</span><span className="font-numeric">{openPo.expectedAt}</span></span>
            </div>

            {openPo.note && <p className="rounded-md bg-surface-sunken p-2 text-sm">{openPo.note}</p>}
            {openPo.cancelReason && (
              <SafetyBanner severity="warning" title="Order cancelled">
                {openPo.cancelReason} — the reason stays on the record, because “why didn&apos;t it arrive?” is
                asked months later.
              </SafetyBanner>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Ordered</th>
                  <th className="py-1 text-right">Received</th>
                  <th className="py-1 text-right">Unit cost</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {openPo.lines.map((l) => {
                  const item = byId.get(l.itemId) as StockItem;
                  return (
                    <tr key={l.itemId} className="border-b border-border-subtle last:border-0">
                      <td className="py-1">
                        <span className="flex flex-col">
                          <span>{item.name}</span>
                          <span className="text-xs text-text-tertiary">{Math.round(l.quantity / item.packSize)} × {item.packUnit}</span>
                        </span>
                      </td>
                      <td className="font-numeric py-1 text-right">{l.quantity.toLocaleString()}</td>
                      <td className={cx('font-numeric py-1 text-right', l.received < l.quantity && 'text-safety-warning')}>
                        {l.received.toLocaleString()}
                        {l.received < l.quantity && <span className="block text-[11px] text-text-tertiary">{l.quantity - l.received} outstanding</span>}
                      </td>
                      <td className="font-numeric py-1 text-right">{money(l.unitCost)}</td>
                      <td className="font-numeric py-1 text-right">{money(lineValue(l))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="ml-auto w-64 text-sm">
              <p className="flex justify-between"><span className="text-text-secondary">Sub-total</span><span className="font-numeric">{money(openTotals.subtotal)}</span></p>
              <p className="flex justify-between"><span className="text-text-secondary">Tax at {openTotals.vatRate} % (supplier record)</span><span className="font-numeric">{money(openTotals.vat)}</span></p>
              <p className="mt-1 flex justify-between border-t border-border-subtle pt-1 font-medium"><span>Total</span><span className="font-numeric">{money(openTotals.total)}</span></p>
              {supplierById(openPo.supplierId) && openTotals.subtotal < (supplierById(openPo.supplierId)?.minOrderValue ?? 0) && (
                <p className="mt-1 text-xs text-safety-warning">
                  Below the {money(supplierById(openPo.supplierId)?.minOrderValue ?? 0)} free-delivery value — expect carriage.
                </p>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* -------------------------------------------------------------------------- receive sheet */}
      <Sheet
        open={receiving !== null}
        onClose={() => setReceiving(null)}
        title={receiving ? `Receive against ${receiving.id}` : ''}
        description="Batch number, expiry and quantity, line by line. Rejections stay on the record."
        width="xl"
        footer={
          receiving && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  const issue = grnIssue(grnLines);
                  if (issue) {
                    push({ title: 'This delivery cannot be received yet', description: issue, tone: 'warning' });
                    return;
                  }
                  const receipt: GoodsReceipt = {
                    id: `GRN-${day.replace(/-/g, '')}-${String(openPo ? 2 : 2).padStart(2, '0')}`,
                    poId: receiving.id,
                    at: stamp(),
                    by: 'You (store)',
                    lines: Object.values(grnLines),
                    varianceNote: grnNote || undefined,
                    witness: grnWitness || undefined,
                  };
                  setDay0((d) => {
                    const newBatches: InvBatch[] = Object.values(grnLines)
                      .filter((l) => !l.rejected)
                      .map((l) => {
                        const item = byId.get(l.itemId) as StockItem;
                        return {
                          id: `${l.itemId}-${l.batchNo}`,
                          drugId: l.itemId,
                          batchNo: l.batchNo,
                          expiry: l.expiry,
                          qty: l.quantity,
                          location: item.coldChain ? 'Fridge·1' : 'Receiving bay',
                          supplier: supplierById(receiving.supplierId)?.name ?? '',
                          unitCost: l.unitCost,
                          store: item.store,
                        };
                      });
                    const movements: StockMovement[] = Object.values(grnLines)
                      .filter((l) => !l.rejected)
                      .map((l, i) => ({
                        id: `MV-GRN-${String(i + 1).padStart(3, '0')}`,
                        at: stamp(),
                        itemId: l.itemId,
                        batchNo: l.batchNo,
                        kind: 'Receipt' as MovementKind,
                        qty: l.quantity,
                        by: 'You (store)',
                        reference: receipt.id,
                        note: l.unitCost !== (byId.get(l.itemId) as StockItem).lastCost ? `Cost differs from the last purchase price (${money(l.unitCost)} vs ${money((byId.get(l.itemId) as StockItem).lastCost)})` : undefined,
                      }));
                    return {
                      ...d,
                      batches: [...newBatches, ...d.batches],
                      movements: [...movements, ...d.movements],
                      receipts: [receipt, ...d.receipts],
                      purchaseOrders: d.purchaseOrders.map((po) => {
                        if (po.id !== receiving.id) return po;
                        const lines = po.lines.map((l) => {
                          const receivedLine = grnLines[l.itemId];
                          if (!receivedLine || receivedLine.rejected) return l;
                          return { ...l, received: Math.min(l.quantity, l.received + receivedLine.quantity) };
                        });
                        const complete = lines.every((l) => l.received >= l.quantity);
                        return { ...po, lines, status: complete ? 'Received' : 'Partially received' };
                      }),
                    };
                  });
                  push({
                    title: `${Object.values(grnLines).filter((l) => !l.rejected).length} line(s) received`,
                    description: `${receipt.id} · batches and expiries recorded${grnWitness ? ` · cold chain checked by ${grnWitness}` : ''}`,
                    tone: 'success',
                  });
                  setReceiving(null);
                }}
              >
                Post the goods receipt
              </Button>
              <Button variant="ghost" onClick={() => setReceiving(null)}>Cancel</Button>
              <span className="text-xs text-text-tertiary">
                {Object.values(grnLines).some((l) => l.rejected)
                  ? 'Rejected lines do not enter stock and do not reach the shelf.'
                  : 'Nothing enters stock without a batch number and an expiry date.'}
              </span>
            </div>
          )
        }
      >
        {receiving && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <span><span className="block text-xs text-text-secondary">Supplier</span>{supplierById(receiving.supplierId)?.name}</span>
              <span><span className="block text-xs text-text-secondary">Ordered</span><span className="font-numeric">{receiving.createdAt}</span></span>
              <span><span className="block text-xs text-text-secondary">Terms</span>{supplierById(receiving.supplierId)?.terms}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th className="py-1">Item</th>
                    <th className="py-1">Batch number</th>
                    <th className="py-1">Expiry</th>
                    <th className="py-1 text-right">Received</th>
                    <th className="py-1 text-right">Unit cost</th>
                    <th className="py-1">Reject</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(grnLines).map((l) => {
                    const item = byId.get(l.itemId) as StockItem;
                    const short = l.quantity < (receiving.lines.find((x) => x.itemId === l.itemId)?.quantity ?? 0);
                    return (
                      <tr key={l.itemId} className="border-b border-border-subtle last:border-0">
                        <td className="py-1">
                          <span className="flex flex-col">
                            <span>{item.name}</span>
                            <span className="text-xs text-text-tertiary">
                              {short ? 'Short delivery' : `${Math.round(l.quantity / item.packSize)} × ${item.packUnit}`}
                              {item.coldChain && ' · 2–8 °C'}
                            </span>
                          </span>
                        </td>
                        <td className="py-1">
                          <input
                            value={l.batchNo}
                            onChange={(e) => setGrnLines((g) => ({ ...g, [l.itemId]: { ...l, batchNo: e.target.value } }))}
                            placeholder="as printed on the pack"
                            className={cx(INPUT, 'w-36', !l.batchNo && !l.rejected && 'border-safety-critical')}
                            aria-label={`Batch number for ${item.name}`}
                          />
                        </td>
                        <td className="py-1">
                          <input
                            type="date"
                            value={l.expiry}
                            onChange={(e) => setGrnLines((g) => ({ ...g, [l.itemId]: { ...l, expiry: e.target.value } }))}
                            className={cx(INPUT, 'w-40', (!l.expiry || endsBefore(l.expiry, day)) && !l.rejected && 'border-safety-critical')}
                            aria-label={`Expiry for ${item.name}`}
                          />
                        </td>
                        <td className="py-1">
                          <input
                            type="number"
                            min={0}
                            value={l.quantity}
                            onChange={(e) => setGrnLines((g) => ({ ...g, [l.itemId]: { ...l, quantity: Number(e.target.value) } }))}
                            className={cx(INPUT, 'w-24 text-right')}
                            aria-label={`Received quantity for ${item.name}`}
                          />
                        </td>
                        <td className="py-1">
                          <input
                            type="number"
                            min={0}
                            value={l.unitCost}
                            onChange={(e) => setGrnLines((g) => ({ ...g, [l.itemId]: { ...l, unitCost: Number(e.target.value) } }))}
                            className={cx(INPUT, 'w-24 text-right', l.unitCost > (receiving.lines.find((x) => x.itemId === l.itemId)?.unitCost ?? 0) * 1.02 && 'border-safety-warning')}
                            aria-label={`Unit cost for ${item.name}`}
                          />
                        </td>
                        <td className="py-1">
                          <span className="flex flex-col gap-1">
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={l.rejected}
                                onChange={(e) => setGrnLines((g) => ({ ...g, [l.itemId]: { ...l, rejected: e.target.checked, rejectReason: e.target.checked ? RECEIPT_REJECT_REASONS[0] : undefined } }))}
                                aria-label={`Reject ${item.name}`}
                              />
                              Reject
                            </label>
                            {l.rejected && (
                              <select
                                value={l.rejectReason}
                                onChange={(e) => setGrnLines((g) => ({ ...g, [l.itemId]: { ...l, rejectReason: e.target.value } }))}
                                className={cx(INPUT, 'w-56')}
                                aria-label={`Rejection reason for ${item.name}`}
                              >
                                {RECEIPT_REJECT_REASONS.map((r) => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Cold chain checked by (required for 2–8 °C items)</span>
                <input value={grnWitness} onChange={(e) => setGrnWitness(e.target.value)} placeholder="e.g. R. Haque (store keeper)" className={cx(INPUT, 'w-72')} />
              </label>
              <label className="flex min-w-64 flex-1 flex-col gap-1">
                <span className={LABEL}>Note on the delivery (short, late, or a price change)</span>
                <input value={grnNote} onChange={(e) => setGrnNote(e.target.value)} placeholder="One line: what was different about this delivery" className={INPUT} />
              </label>
            </div>

            <p className="text-xs text-text-tertiary">
              A unit cost above the order price is highlighted: it is not refused, but somebody has to have seen it
              before the invoice is passed for payment.
            </p>
          </div>
        )}
      </Sheet>

      {/* ---------------------------------------------------------------------------- write-off sheet */}
      <Sheet
        open={writeOff !== null}
        onClose={() => setWriteOff(null)}
        title={writeOff ? `Write off ${byId.get(writeOff.drugId)?.name} · ${writeOff.batchNo}` : ''}
        description={writeOff ? `${writeOff.qty.toLocaleString()} ${byId.get(writeOff.drugId)?.unit} · expires ${writeOff.expiry} · ${money(writeOff.qty * writeOff.unitCost)} at cost` : ''}
        width="md"
        footer={
          writeOff && (
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  setDay0((d) => ({
                    ...d,
                    batches: d.batches.map((b) => (b.id === writeOff.id ? { ...b, qty: 0 } : b)),
                    movements: [
                      {
                        id: `MV-WO-${String(d.movements.length + 1).padStart(3, '0')}`,
                        at: stamp(),
                        itemId: writeOff.drugId,
                        batchNo: writeOff.batchNo,
                        kind: expiryState(writeOff.expiry, day) === 'expired' ? 'Write-off (expired)' : 'Write-off (damaged)',
                        qty: -writeOff.qty,
                        by: 'You (store)',
                        reference: `WO-${day.replace(/-/g, '')}-${String(d.movements.filter((m) => m.kind.startsWith('Write-off')).length + 1).padStart(2, '0')}`,
                        note: writeOffReason,
                      },
                      ...d.movements,
                    ],
                  }));
                  push({ title: 'Written off', description: `${writeOffReason} · a witness signs the waste log on the paper form`, tone: 'warning' });
                  setWriteOff(null);
                }}
              >
                Write off and record the reason
              </Button>
              <Button variant="ghost" onClick={() => setWriteOff(null)}>Cancel</Button>
            </div>
          )
        }
      >
        {writeOff && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Reason</span>
              <select value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} className={INPUT}>
                {['Expired on the shelf', 'Damaged in the store', 'Cold chain broken', 'Recalled by the supplier', 'Short-dated return to the supplier'].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <SafetyBanner severity="warning" title="This is stock leaving the books">
              The batch drops to zero, a movement goes into the ledger with your reason, and the value leaves the
              stock figure. Nothing is ever deleted — a store that cannot explain a loss cannot be audited.
            </SafetyBanner>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------------------ transfer sheet */}
      <Sheet
        open={transfer !== null}
        onClose={() => setTransfer(null)}
        title={transfer ? `Transfer ${byId.get(transfer.drugId)?.name} · ${transfer.batchNo}` : ''}
        description="Between the hospital's own stores — the batch and its expiry travel with the stock."
        width="md"
        footer={
          transfer && (
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  if (transferQty <= 0 || transferQty > transfer.qty) {
                    push({ title: 'Check the quantity', description: `Between 1 and ${transfer.qty} ${byId.get(transfer.drugId)?.unit}`, tone: 'warning' });
                    return;
                  }
                  setDay0((d) => ({
                    ...d,
                    batches: [
                      ...d.batches.map((b) => (b.id === transfer.id ? { ...b, qty: b.qty - transferQty } : b)),
                      {
                        ...transfer,
                        id: `${transfer.id}-to-${transferTo.replace(/\s+/g, '-').toLowerCase()}`,
                        qty: transferQty,
                        store: transferTo,
                        location: transferTo === 'Theatre store' ? 'Theatre cupboard' : 'Ward cupboard',
                      },
                    ],
                    movements: [
                      {
                        id: `MV-TR-${String(d.movements.length + 1).padStart(3, '0')}`,
                        at: stamp(),
                        itemId: transfer.drugId,
                        batchNo: transfer.batchNo,
                        kind: 'Transferred between stores',
                        qty: transferQty,
                        by: 'You (store)',
                        reference: `TR-${day.replace(/-/g, '')}-${String(d.movements.filter((m) => m.kind === 'Transferred between stores').length + 1).padStart(2, '0')}`,
                        note: `${transfer.store} → ${transferTo}`,
                      },
                      ...d.movements,
                    ],
                  }));
                  push({ title: `Transferred to ${transferTo}`, description: `${transferQty} ${byId.get(transfer.drugId)?.unit} · batch ${transfer.batchNo}`, tone: 'success' });
                  setTransfer(null);
                }}
              >
                Transfer
              </Button>
              <Button variant="ghost" onClick={() => setTransfer(null)}>Cancel</Button>
            </div>
          )
        }
      >
        {transfer && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span><span className="block text-xs text-text-secondary">Batch</span><span className="font-numeric">{transfer.batchNo}</span></span>
              <span><span className="block text-xs text-text-secondary">Expiry</span><span className="font-numeric">{transfer.expiry}</span></span>
              <span><span className="block text-xs text-text-secondary">On hand</span>{transfer.qty.toLocaleString()} {byId.get(transfer.drugId)?.unit}</span>
              <span><span className="block text-xs text-text-secondary">From</span>{transfer.store}</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Transfer to</span>
              <select value={transferTo} onChange={(e) => setTransferTo(e.target.value as (typeof STORES)[number])} className={INPUT}>
                {STORES.filter((s) => s !== transfer.store).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Quantity ({byId.get(transfer.drugId)?.unit})</span>
              <input type="number" min={1} max={transfer.qty} value={transferQty} onChange={(e) => setTransferQty(Number(e.target.value))} className={cx(INPUT, 'w-32')} />
            </label>
            {byId.get(transfer.drugId)?.controlled && (
              <SafetyBanner severity="critical" title="Controlled item">
                A controlled transfer needs a witness and the register entry: quantity in words, both signatures.
                Until that is recorded here, the cupboard stays locked.
              </SafetyBanner>
            )}
          </div>
        )}
      </Sheet>

      {/* -------------------------------------------------------------------------------- cancel sheet */}
      <Sheet
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={cancelling ? `Cancel ${cancelling.id}` : ''}
        description="A cancelled order stays on the record with its reason."
        width="md"
        footer={
          cancelling && (
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={cancelReason.trim().length < 4}
                onClick={() => {
                  patchPo(cancelling.id, (p) => ({ ...p, status: 'Cancelled', cancelReason: cancelReason.trim() }));
                  push({ title: `${cancelling.id} cancelled`, description: cancelReason.trim(), tone: 'warning' });
                  setCancelling(null);
                  setOpenPo(null);
                }}
              >
                Cancel the order
              </Button>
              <Button variant="ghost" onClick={() => setCancelling(null)}>Keep it</Button>
            </div>
          )
        }
      >
        {cancelling && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Why is this order being cancelled?</span>
              <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="At least a few words — the supplier will ask" className={INPUT} />
            </label>
            <ul className="list-disc pl-5 text-sm text-text-secondary">
              <li>{cancelling.lines.length} line(s), {cancelling.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString()} units</li>
              <li>{money(poTotals(cancelling).total)} including tax</li>
              <li>Nothing on this order has been received{cancelling.status === 'Partially received' ? ' in full — the received lines stay in stock and in the ledger' : ''}.</li>
            </ul>
          </div>
        )}
      </Sheet>
    </div>
  );
}
