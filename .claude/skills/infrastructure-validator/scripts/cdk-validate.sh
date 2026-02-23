#!/usr/bin/env bash
set -uo pipefail

# プロジェクトルートへ移動
cd "$(dirname "$0")/../../../.."

INFRA_DIR="infrastructure"
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

run_phase() {
  local phase_name="$1"
  shift
  echo "=== $phase_name ==="
  if ! "$@" > "$TMPFILE" 2>&1; then
    cat "$TMPFILE"
    echo ""
    echo "FAILED: $phase_name"
    exit 1
  fi
}

# Phase 1: CDK Synth
run_phase "Phase 1: CDK Synth" npx cdk synth --all --app "npx ts-node $INFRA_DIR/bin/app.ts"

# Phase 2: cfn-nag セキュリティスキャン
if command -v cfn_nag_scan &> /dev/null; then
  run_phase "Phase 2: cfn-nag Security Scan" cfn_nag_scan --input-path "$INFRA_DIR/cdk.out/" --output-format json
else
  echo "=== Phase 2: cfn-nag Security Scan ==="
  echo "SKIPPED: cfn_nag_scan not installed (gem install cfn-nag)"
fi

# Phase 3: CDK テスト
run_phase "Phase 3: CDK Tests" bash -c "cd $INFRA_DIR && npm test"

# Phase 4: CDK型チェック・Lint
echo "=== Phase 4: CDK Type Check & Lint ==="
if ! bash -c "cd $INFRA_DIR && npm run type-check" > "$TMPFILE" 2>&1; then
  cat "$TMPFILE"
  echo ""
  echo "FAILED: Phase 4: CDK Type Check"
  exit 1
fi
if ! bash -c "cd $INFRA_DIR && npm run lint" > "$TMPFILE" 2>&1; then
  cat "$TMPFILE"
  echo ""
  echo "FAILED: Phase 4: CDK Lint"
  exit 1
fi

# Phase 5: 変更影響分析（差分確認）
echo "=== Phase 5: Change Impact Analysis ==="
# cdk diff は差分があると exit 1 を返すため、出力のみ表示（失敗扱いにしない）
npx cdk diff --app "npx ts-node $INFRA_DIR/bin/app.ts" 2>&1 || true

# 破壊的変更の検出（警告のみ）
if npx cdk diff --app "npx ts-node $INFRA_DIR/bin/app.ts" 2>&1 | grep -qE "(Replacement|will be replaced)"; then
  echo "WARNING: Destructive changes detected. Review required."
fi

echo ""
echo "All CDK validation phases passed."
exit 0
