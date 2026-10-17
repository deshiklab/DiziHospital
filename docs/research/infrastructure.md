# Infrastructure survey (P0-103)

Fill one block per branch. Everything here feeds the edge node spec, the network design and the outage drill.

**Surveyed by:** _name / role_ · **Date:** _YYYY-MM-DD_ · **Branch:** _name_

## 1. Internet and power (the two things that decide the architecture)

| Item | Current state | What we need | Owner | Date |
|---|---|---|---|---|
| Internet provider(s) and bandwidth | | ≥ 20 Mbps symmetric for the edge sync; two providers if available | | |
| Outages in the last 6 months (count, duration, cause) | | Baseline for the outage drill and staff trust | | |
| Router/firewall make, model, who manages it | | Port-forward/tunnel for sync; documentation | | |
| Static IP available? | | Simplifies mTLS sync and remote support | | |
| UPS on network gear and server room | | Edge node must ride through short outages; 30+ min target | | |
| Generator / power backup behaviour | | Graceful shutdown + restart procedure | | |
| Server room: rack space, cooling, noise, physical security | | Edge node placement | | |

## 2. Local network

| Item | Current state | What we need | Owner | Date |
|---|---|---|---|---|
| VLANs / subnets (counters, wards, pharmacy, lab, admin) | | Edge node reachable from all clinical segments | | |
| Wi-Fi coverage on wards and OPD (SSID, dropouts, dead spots) | | Ward tablets need stable coverage; note the worst two spots | | |
| Managed switches / port availability | | Dedicated port + UPS outlet for the edge node | | |
| DHCP/DNS control | | Fixed IP + hostname for the edge node (e.g. `dizi.local`) | | |

## 3. Devices and peripherals (per station)

| Station | Workstation/tablet | Printer (model, paper) | Scanner/label | Notes |
|---|---|---|---|---|
| Reception counter 1 | | | | |
| Reception counter 2 | | | | |
| OPD desk 1 | | | | |
| Pharmacy counter | | | | |
| Lab bench | | | | |
| Billing counter | | | | |
| Ward A tablet(s) | | | | |

**Paper formats actually in use** (photograph a sample of each and attach): A4 report, A5 slip, thermal 80 mm
receipt, label 50×25 mm, other: ______

## 4. Clinical equipment and external systems

| System | Vendor / model | Interface available (HL7 v2, ASTM, DICOM, none) | Who supports it | Branch |
|---|---|---|---|---|
| Lab analysers | | | | |
| Imaging / PACS | | | | |
| Blood bank | | | | |
| ECG / monitors | | | | |
| Biometric / QR attendance | | | | |
| Payment terminals / mobile banking | | | | |
| Patient portal / website host | | | | |

## 5. Backups and recovery today

| Item | Current state | Gap we must close |
|---|---|---|
| Who takes backups, how often, where | | |
| Last restore test (date, result) | | |
| Where the data physically lives | | Edge node + off-site copy at the cloud tier |
| Retention expectations from the hospital / regulator | | Feeds `06` §7 and the archive plan |

## 6. Findings that already look like work

| # | Finding | Consequence | Ticket / phase |
|---|---|---|---|
| 1 | _e.g. no UPS on the switch cabinet_ | Outage drill would fail | |
| 2 | | | |
