#!/usr/bin/env bash
# Run the evaluation against a real model instead of the offline mock.
#
# Everything committed to this repo was produced by the mock. That is deliberate
# — a reviewer must be able to reproduce every number with no key and no cost —
# but it leaves one claim untested: that the verdict is identical either way.
# This script is how that claim gets substantiated rather than asserted.
#
# The verdicts should not move. If they do, the architecture is wrong, and that
# result is worth more than a green tick.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is not set."
  echo "The live path cannot run. evals/raw/metrics.live.json records that honestly."
  exit 1
fi

echo "Running the live evaluation on ${AVOS_LLM_MODEL:-gpt-4o-mini}."
echo "This makes one model call per case and costs real money."

AVOS_USE_MOCK=0 npx tsx evals/eval.ts

cp evals/raw/metrics.json evals/raw/metrics.live.json
echo
echo "Wrote evals/raw/metrics.live.json"
echo "Diff the verdict columns against evals/raw/batch_120.json from a mock run."
echo "They should be identical. Publish the comparison either way."
