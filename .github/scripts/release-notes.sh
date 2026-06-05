#!/usr/bin/env bash
#
# Generate categorized Markdown release notes from commit subjects.
#
# Reads one commit subject per line on stdin, classifies each line into
# Features / Fixes / Overig, and prints Markdown. Empty sections are omitted.
# The heading (e.g. "## Wijzigingen sinds v0.2.0") is passed as the first arg.
#
# Classification is best-effort: a leading conventional-commit type
# ("feat:", "fix:", "chore:", ...) wins; otherwise the leading keyword of the
# subject decides; anything unrecognized lands in Overig.
#
# Usage:
#   git log --no-merges --pretty=format:'%s' PREV..HEAD \
#     | bash release-notes.sh "## Wijzigingen sinds PREV"
set -euo pipefail

heading="${1:-## Wijzigingen}"

features=()
fixes=()
other=()

# Echo the bucket name (features|fixes|other) for a single commit subject.
classify() {
  local lc="${1,,}"        # lowercased subject
  local type="${lc%%:*}"   # text before the first ':' (conventional type)

  case "$type" in
    feat | feature | features) echo features ;;
    fix | fixes | bugfix | hotfix) echo fixes ;;
    docs | doc | chore | refactor | style | test | tests | build | ci | perf | deps | revert)
      echo other
      ;;
    *)
      # No conventional prefix — fall back to the leading word.
      case "$lc" in
        add\ * | adds\ * | added\ * | implement* | introduce* | support* | new\ * | enable* | create* | allow*)
          echo features
          ;;
        fix* | block* | prevent* | avoid* | resolve* | correct* | repair* | patch* | guard* | catch* | handle* | ensure*)
          echo fixes
          ;;
        *)
          echo other
          ;;
      esac
      ;;
  esac
}

while IFS= read -r subject; do
  # Trim leading/trailing whitespace — a stray leading space (e.g. " Add X")
  # would otherwise dodge every keyword match and fall through to Overig.
  subject="${subject#"${subject%%[![:space:]]*}"}"
  subject="${subject%"${subject##*[![:space:]]}"}"
  [ -z "$subject" ] && continue
  case "$(classify "$subject")" in
    features) features+=("- $subject") ;;
    fixes) fixes+=("- $subject") ;;
    *) other+=("- $subject") ;;
  esac
done

# Print "### Title" + bullet lines, but only when the bucket has entries.
emit_section() {
  local title="$1"
  shift
  [ "$#" -eq 0 ] && return 0
  printf '\n### %s\n' "$title"
  printf '%s\n' "$@"
}

printf '%s\n' "$heading"
emit_section "Features" ${features[@]+"${features[@]}"}
emit_section "Fixes" ${fixes[@]+"${fixes[@]}"}
emit_section "Overig" ${other[@]+"${other[@]}"}
