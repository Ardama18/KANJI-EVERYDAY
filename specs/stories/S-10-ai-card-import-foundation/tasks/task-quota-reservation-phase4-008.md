# タスク: 安定SQL error helperとJST quota予約RPCを実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 4
- 依存: `tasks/task-session-review-triggers-phase3-007.md`（Phase 3 quality approved）
- 提供成果物: SQLSTATE helper、transaction-local内部flag、`reserve_provider_usage` wrapper/internal、IT-QUOTA 8件
- 関連AC: AC-05、IT-QUOTA-01〜08
- サイズ: 大きめ（concurrency RPC + 8 Integration）

## 実装内容

Designの安定SQLSTATE/error codeとsafe detailを定義し、DB clockのJST日付、owner-scoped advisory、usage/reservation台帳でprovider直前予約を原子的・冪等にする。app card/AI illustrationだけを課金し、remote MCP card/upload imageの免除は保存済みtrusted contextから決める。

## 対象ファイル

- [ ] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `IT-QUOTA-01〜08`をfixed DB clock/複数connectionの失敗テストへ置換する。
- [ ] JST境界、199+1/199+2、49+1/49+2、異なるkey並行、同key再送、exempt、開始後非返却を検証する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-QUOTA"
```

### 2. Green Phase

- [ ] `P1000〜P1008`と`42501`を安定code/safe detailへ対応させ、不明な`23505`を一律duplicateにしない。
- [ ] service_role専用wrapperと外部grantなしinternalを分離し、owner/source/hash/kind/units/関連を再検証する。
- [ ] advisory→既存reservation non-lock read→batch/item→usage `FOR UPDATE`→reservationの順を固定する。
- [ ] DB clockを`Asia/Tokyo`へ変換し、card 200/image 50超過だけを`QUOTA_EXCEEDED`にする。
- [ ] 同key同内容は同じ結果/加算0、差分は`CONFLICT`、予約成功時に`provider_started_at`を設定し返却しない。

### 3. Refactor Phase

- [ ] test-only clock/failpointを公開RPCと分離し、production clockをclient値で上書き不能にする。
- [ ] error/logにgeneration hash、reservation key、本文、SQL、stackを出さない。

## 完了条件

- [ ] `IT-QUOTA-01〜08`が実DBでPASSする。
- [ ] 並行成功合計がcard 200/image 50を超えず、同key再送の二重消費が0である。
- [ ] remote_mcp/uploadの免除をclient flagで偽装できない。
- [ ] authenticatedからwrapper、service_roleからinternalを直接実行できない。
- [ ] 動作確認レベルL2を満たす。

## 注意事項

- provider呼出、Queue、retry orchestrationは起動しない。
- commitはこのタスクでusageを加算せず、次タスクでreservation linkだけを確定する。

