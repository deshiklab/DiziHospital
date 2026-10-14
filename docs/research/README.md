# Research folder — how week 1 is run

These files are the **templates the hospital team fills in during week 1** (plan `07` §Week 1). They are
deliberately plain markdown: every answer goes in the repo, in a diff, next to the plan that depends on it.

| File | Ticket | Who fills it | Why it matters |
|---|---|---|---|
| [`infrastructure.md`](infrastructure.md) | P0-103 | platform + hospital IT | Determines the edge node spec, the print/label setup, analyser and PACS integration work, and what breaks when the internet dies |
| [`branches.md`](branches.md) | P0-104 | sponsor + clinical lead | Chooses the pilot branch and records why (O6) |
| [`shadowing.md`](shadowing.md) | P0-101 | designer + BA | The evidence behind every UX decision; replaces opinion with observation |
| [`baseline-tasks.md`](baseline-tasks.md) | P0-102 | designer | The numbers the new UI must beat (\"≤ legacy − 30 %\") |
| [`hardware.md`](hardware.md) | P0-004 | hospital IT | Reference devices for print/scanner work; the paper formats we must reproduce |

Rules for anyone filling these in:

1. **No patient-identifiable data.** Record roles, timings and patterns, never names, MRNs or phone numbers.
2. **Ask before photographing** anything, and blur screens in photos.
3. **Write down the workaround, not just the problem** — the paper register beside the counter is a requirement
   nobody documented.
4. **One fact per row**, with who said it and when. \"The printer is slow\" is not a finding; \"thermal printer
   on counter 2 takes 9 s per receipt, staff print two copies and file one\" is.
5. **Update in place during week 1**; the day-7 demo presents these files, not slides.
