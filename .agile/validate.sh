#!/usr/bin/env bash
set -u

NONCE="${1:-}"
RESULT_FILE=".agile/validation-result.json"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

TEST_OUTPUT="$(mktemp)"
TEST_PASSED=false

if make val >"$TEST_OUTPUT" 2>&1; then
  TEST_PASSED=true
fi

TEST_JSON_OUTPUT="$(json_escape < "$TEST_OUTPUT")"
rm -f "$TEST_OUTPUT"

cat > "$RESULT_FILE" <<EOF
{
  "nonce": "$NONCE",
  "timestamp": "$TIMESTAMP",
  "passed": $TEST_PASSED,
  "steps": [
    {
      "name": "cypress acceptance tests",
      "passed": $TEST_PASSED,
      "output": $TEST_JSON_OUTPUT
    }
  ]
}
EOF

if [ "$TEST_PASSED" = true ]; then
  exit 0
else
  exit 1
fi
