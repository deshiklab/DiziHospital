#!/usr/bin/env bash
# Apply the P0 labels and milestone to the tickets created from docs/plan/09-EXECUTION-BACKLOG-P0.md.
#
# Why this exists: the automated sandbox session that created the 54 issues could create them
# but could not set labels or milestones (HTTP 403 "Resource not accessible by integration").
# Running this script with a normal developer account fixes that in one pass.
#
# Usage:  GH_REPO=deshiklab/DiziHospital bash tools/gh/p0-board.sh [--dry-run]
set -euo pipefail

REPO="${GH_REPO:-deshiklab/DiziHospital}"
MILESTONE="P0 — Foundations (weeks 0–4)"
DRY="${1:-}"

command -v gh >/dev/null || { echo "gh CLI not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "not logged in to gh"; exit 1; }

echo "→ repo: $REPO"

# 1. labels
create_label() {
  gh label create "$1" --repo "$REPO" --color "$2" ${3:+--description "$3"} --force >/dev/null
  echo "  label $1"
}
create_label "P0" "0E6E7A" "Phase 0 ticket"
for a in platform web api sync; do create_label "area:$a" "1D4ED8" ""; done
for a in design data;        do create_label "area:$a" "B26B00" ""; done
for a in ops docs;           do create_label "area:$a" "5A6B7B" ""; done
create_label "type:spike" "B3261E" "Time-boxed investigation"

# 2. milestone
if ! gh api "repos/$REPO/milestones?state=all&per_page=100" --jq '.[].title' | grep -Fxq "$MILESTONE"; then
  gh api "repos/$REPO/milestones" -f title="$MILESTONE" \
    -f description="Phase 0 from docs/plan/09-EXECUTION-BACKLOG-P0.md" >/dev/null
  echo "  milestone created"
fi

# 3. labels + milestone per issue, keyed by the ticket id in the title
gh issue list --repo "$REPO" --limit 300 --state all --json number,title \
| python3 -c '
import json,sys,re
for i in json.load(sys.stdin):
    m = re.match(r"^(P0-\d+)", i["title"])
    if m: print(f"{i[\"number\"]}\t{m.group(1)}")
' | while IFS=$'\t' read -r number ticket; do
  area=$(grep -E "^\| ${ticket} \|" docs/plan/09-EXECUTION-BACKLOG-P0.md | head -1 | awk -F'|' '{gsub(/ /,"",$4); print $4}')
  [ -z "$area" ] && area=platform
  if [ "$DRY" = "--dry-run" ]; then
    echo "  would label #$number ($ticket) area:$area + P0 + milestone"
  else
    gh issue edit "$number" --repo "$REPO" \
      --add-label "P0" --add-label "area:$area" --milestone "$MILESTONE" >/dev/null
    echo "  #$number $ticket → P0, area:$area"
  fi
done

echo "done."
