# Hardware inventory and reference devices (P0-004)

Reference devices matter more than they look: print and scan behaviour is the single most common reason a
clinical pilot day fails, and we can only test it on the machines the counters actually use.

## 1. Reference devices to buy (one of each, kept by the team)

| # | Device | Specification to buy | Why | Ordered | Arrived | Location |
|---|---|---|---|---|---|---|
| 1 | Thermal receipt printer | 80 mm, ESC/POS, USB + Ethernet | Every billing counter prints receipts | | | `edge-lab` |
| 2 | A4 laser printer | Duplex, 30+ ppm, network | Reports, prescriptions, discharge summaries | | | `edge-lab` |
| 3 | Label printer | 50×25 mm, thermal transfer | Specimen labels, IV bags, files | | | `edge-lab` |
| 4 | Barcode scanner | USB keyboard-wedge (no drivers needed) | MRN bands, specimen tubes, stock | | | `edge-lab` |
| 5 | Tablet | 10", Wi-Fi, current OS | Ward rounds, PWA offline queue | | | `edge-lab` |
| 6 | Edge node | Per `docs/research/edge-node-spec.md` | The hospital runs on it | | | hospital |

## 2. What we must reproduce exactly

| Item | Detail we need (measure, don't guess) | Where recorded |
|---|---|---|
| Receipt layout | Width in characters, what prints top/bottom, logo, QR? | sample photographed + attached |
| Prescription layout | A4 or A5, header/footer, signature line, hospital name in Bangla | sample photographed |
| Specimen label | Size, barcode type, fields on the label | sample photographed |
| Report header | Which reports carry the hospital logo and which do not | samples |

## 3. Per-branch reality (copy per branch)

| Station | Device | Age/condition | Interface | Who fixes it when it breaks | Replacement plan |
|---|---|---|---|---|---|
| | | | | | |

## 4. Findings

| # | Finding | Impact on build or pilot | Action |
|---|---|---|---|
| 1 | _e.g. receipts print in a language the operators cannot read_ | Print templates must be Bangla-first | Ticket |
| 2 | | | |
