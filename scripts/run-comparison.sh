#!/usr/bin/env bash
#
# run-comparison.sh — Run every idea in test-ideas/ against multiple models and
# persist each run's outputs so they can be compared later.
#
# Each run overwrites root result.json and rebuilds output/app, so this script
# copies the important outputs out into comparisons/<model>/<idea>/ immediately
# after every run, and appends one row per (idea × model) to comparisons/summary.csv.
#
# Usage:
#   BERGET_API_KEY=... ./scripts/run-comparison.sh                 # all ideas, all MODELS below
#   BERGET_API_KEY=... ./scripts/run-comparison.sh pantry-tracker  # only matching idea files
#   MODELS_ONLY=glm52 ./scripts/run-comparison.sh                  # only one model (by slug)
#
# Edit the MODELS array below to change the provider/model matrix. Each entry is
# "slug|CHALLENGE_PROVIDER|CHALLENGE_MODEL". The model id must exist in
# solution/provider-config/models.json.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IDEAS_DIR="test-ideas"
OUT_DIR="comparisons"
SUMMARY_CSV="$OUT_DIR/summary.csv"

# slug | provider | model-id
MODELS=(
  "glm52|berget|zai-org/GLM-5.2"
  "qwen38|berget|Qwen/Qwen3.8-27B-FP8"
)

# Optional filter: comma-separated list of model slugs to include (e.g. MODELS_ONLY=glm52).
MODEL_SLUG_FILTER="${MODELS_ONLY:-}"

# Fail-fast wall-clock cap per run (ms). A weak model that emits a malformed IR
# can otherwise burn the full default (15 min) hand-repairing before it is killed.
# Capping at 4 min keeps a doomed run cheap without cutting off a healthy compile.
# Override by exporting CHALLENGE_TIMEOUT_MS before invoking this script.
SWEEP_TIMEOUT_MS="${CHALLENGE_TIMEOUT_MS:-240000}"

mkdir -p "$OUT_DIR"

# Build the idea list: args (name stems, with or without .txt) or all *.txt.
declare -a IDEA_FILES=()
if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    stem="${arg%.txt}"
    f="$IDEAS_DIR/$stem.txt"
    if [[ -f "$f" ]]; then IDEA_FILES+=("$f"); else echo "!! no such idea file: $f" >&2; fi
  done
else
  while IFS= read -r f; do IDEA_FILES+=("$f"); done < <(find "$IDEAS_DIR" -maxdepth 1 -name '*.txt' -size +0c | sort)
fi

if [[ ${#IDEA_FILES[@]} -eq 0 ]]; then
  echo "No idea files to run." >&2; exit 1
fi

# CSV header (created once).
if [[ ! -f "$SUMMARY_CSV" ]]; then
  echo "timestamp,model_slug,provider,model_id,idea,status,model_calls,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,total_tokens,weighted_token_expenditure,cost_total,pi_exit_code,run_dir" > "$SUMMARY_CSV"
fi

echo "Ideas: ${#IDEA_FILES[@]}   Models: ${#MODELS[@]}   Per-run timeout: $((SWEEP_TIMEOUT_MS / 1000))s"
echo "Writing outputs under $OUT_DIR/ and rows to $SUMMARY_CSV"
echo

for entry in "${MODELS[@]}"; do
  IFS='|' read -r slug provider model_id <<< "$entry"
  if [[ -n "$MODEL_SLUG_FILTER" && ",$MODEL_SLUG_FILTER," != *",$slug,"* ]]; then
    echo "-- skipping model $slug (not in MODELS_ONLY)"; continue
  fi

  for idea_file in "${IDEA_FILES[@]}"; do
    idea_slug="$(basename "$idea_file" .txt)"
    run_dir="$OUT_DIR/$slug/$idea_slug"
    mkdir -p "$run_dir"

    echo "=============================================================="
    echo ">> model=$slug ($provider :: $model_id)   idea=$idea_slug"
    echo "=============================================================="

    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    CHALLENGE_PROVIDER="$provider" CHALLENGE_MODEL="$model_id" CHALLENGE_TIMEOUT_MS="$SWEEP_TIMEOUT_MS" \
      npm run challenge -- --idea-file "$idea_file" \
      > "$run_dir/run.log" 2>&1
    exit_code=$?
    echo "   challenge exit code: $exit_code (full log: $run_dir/run.log)"

    # Copy the run's outputs out before the next run overwrites them.
    for f in result.json summary.md idea_spec.json product-ir.json trace.jsonl; do
      [[ -f "output/app/$f" ]] && cp "output/app/$f" "$run_dir/$f"
    done
    # Fallback for result.json (root copy) if app copy is missing.
    [[ ! -f "$run_dir/result.json" && -f result.json ]] && cp result.json "$run_dir/result.json"
    cp "$idea_file" "$run_dir/idea.txt"

    # Append a CSV row parsed from result.json (empty fields if it is missing).
    node scripts/append-comparison-row.mjs \
      "$SUMMARY_CSV" "$ts" "$slug" "$provider" "$model_id" "$idea_slug" \
      "$run_dir/result.json" "$exit_code" "$run_dir" || echo "   !! could not append CSV row"
    echo
  done
done

echo "Done. Compare with:  node scripts/compare-report.mjs"
