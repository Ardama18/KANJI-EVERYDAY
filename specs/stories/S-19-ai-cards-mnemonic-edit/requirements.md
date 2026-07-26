# S-19 requirements: /ai/cards のニーモニック表示・編集と不要 UI の削除

入力は issue #64（本文をそのまま要件として採用）。本ファイルは issue の受入条件を正本化し、
実測で確認した前提と、issue 記載と実装が食い違っていた点を記録する。

## 1. スコープ

含む。

1. `list_ai_managed_cards` の返却 JSON へ `illustrationKey` / `mnemonic` / `mnemonicSharedCardCount` を追加する。
2. サーバ層（types / repository / service / Server Action）にニーモニック更新経路を追加する。
3. `/ai/cards` にニーモニック表示・編集 UI を追加する。
4. `/ai/cards` からイラスト選択・「イラストを保存」・「登録バッチを取り消す」を削除する。
5. MCP の `list_ai_cards` 応答を現行と同一に保つ。

含まない（Out of Scope。issue #64 の記載を厳守する）。

- イラスト画像の再生成。`ai_illustration_objects` は `service_role` にも INSERT/UPDATE/DELETE を与えていない設計のため
  （`supabase/migrations/20260715000000_s11_ai_card_async_processing.sql:275-277`）新しい特権 RPC が必要になる。
  `reference_count` を動かすのは `cards.illustration_key` 変更トリガのみで（同 `:1517-1537`）再生成では発火しない。
  `complete_ai_import_cleanup` は旧ファイル削除時に同じ `illustrations` 行を `status='failed', storage_path=NULL` に落とす（同 `:1874-1876`）。
- `list_ai_managed_cards` の illustration 並び順不一致（`ORDER BY candidate.id` と `updated_at DESC, id DESC`）の修正。
- S-08 系と S-11 系の Storage 保存先規約の一本化。
- Remote MCP からのニーモニック書き込み。
- 承認 UI コンポーネント本体の作り替え。共通化は上限定義と検証関数の再利用までに留める。
- `set_card_illustration` / `undo_import` RPC そのものの削除。
- Remote MCP の `update_ai_card` から `illustrationId` を、ツール一覧から `undo_import_batch` を外すこと。
- `undo_import` の確認文と実装の食い違いそのものの修正。
- ニーモニック編集時に `ai_import_items.user_edited_at` を立てる変更。

## 2. 実測で確認した前提（2026-07-26、`9134703`）

issue 本文の Current State を再検証した。#1〜#10 は記載どおりで、#11 のみ表現を訂正する。

| # | 事実 | 根拠 | 検証結果 |
|---|---|---|---|
| 1 | `card_mnemonics` は `(owner_user_id, illustration_key)` UNIQUE。`card_id` を持たない | `supabase/migrations/20260721000001_s16_card_mnemonics.sql:13` | 一致 |
| 2 | 同テーブルは owner の SELECT/INSERT/UPDATE ポリシーと `GRANT ... TO authenticated` を持つ | 同 `:24-41` | 一致 |
| 3 | slots: `kanji` / `isSingleKanji` / `shapeHint{part,picture}` / `meaningHint` / `story` | `frontend/src/lib/ai-card-generation/contracts.ts:28-34` | 一致 |
| 4 | explanation: `summary` / `mappings[{part,meaning}]` | 同 `:36-39` | 一致 |
| 5 | 上限は kanji 16 / text 100 / summary 120 / mappings 2〜4。`isMnemonicEntryValid` はエクスポート済み | `frontend/src/components/ai-card-import/MnemonicApprovalList.tsx:30-36,286-310` | 一致 |
| 6 | `MNEMONIC_LIMITS` は非エクスポート | 同 `:30` | 一致 |
| 7 | 一覧 RPC は `list_ai_managed_cards`。UI と Remote MCP の両方が呼ぶ | `app-ai-repository.ts:15`、`remote-mcp-repository.ts:24` | 一致 |
| 8 | 同 RPC は key で join 済みだが射影していない | `20260719000001_s13_ai_card_management_undo.sql:124-127` | 一致 |
| 9 | `ManagedAiCard` は `illustrationKey` も mnemonic も持たない | `frontend/src/lib/ai-card-management/types.ts:20-34` | 一致 |
| 10 | MCP の `list_ai_cards` は service 結果を素通しで返す | `frontend/src/lib/mcp/tools.ts:247-250`、`services.ts:66` | 一致 |
| 11 | 学習画面は `card_mnemonics` の explanation を表示済み | `frontend/src/actions/session-actions.ts:530-552,711` | **訂正**（下記 R-1） |

追加で確認した前提。

| # | 事実 | 根拠 |
|---|---|---|
| 12 | `card_mnemonics` の table owner は `s10_migration_owner`。RLS をバイパスするため既存 DEFINER 経路も動く | `supabase/migrations/20260724000000_s16_card_mnemonics_owner_fix.sql` |
| 13 | `list_ai_managed_cards` の owner / REVOKE / GRANT は S-13 migration の末尾で設定済み。後続 migration での定義差し替え先例は `commit_import_async`（`20260719000002_s14_...sql:246` と `:612`）で、`CREATE OR REPLACE` 後に `ALTER FUNCTION ... OWNER TO` を再発行している | `20260719000001_...sql:749,773,780`、`20260719000002_...sql:246,612` |
| 14 | `idx_cards_illustration_key` が存在するため共有枚数カウントは index 利用できる。新規 index は不要 | `supabase/migrations/20260223000000_s02_schema_rls.sql:85` |
| 15 | サーバ側 mnemonic サニタイザ（NFKC＋length-cap＋mappings 2–4）が既にある。`MNEMONIC_TEXT_LIMITS` と `sanitizeMnemonicSlots` / `sanitizeMnemonicExplanation` は非エクスポート | `frontend/src/lib/ai-import/service.ts:267-388` |
| 16 | `MnemonicApprovalList.tsx` は `"use client"`。ここからエクスポートした関数はサーバから呼べない | 同 `:1` |
| 17 | `frontend/src/types/database.ts` に `card_mnemonics` の Row/Insert/Update が定義済み。`.from("card_mnemonics").upsert()` は型が通る | `frontend/src/types/database.ts:551-583` |
| 18 | テスト環境は node。`@testing-library/react` も jsdom も未導入で、コンポーネントテストは `renderToStaticMarkup` のみ | `frontend/package.json`、`frontend/vitest.config.ts` |
| 19 | `src/**/*.int.test.ts` は `*.test.ts` にマッチするため `npm test` に含まれる。`S10_TEST_DATABASE_URL` 未設定では env 起因で落ちる（既知・回帰ではない） | `frontend/vitest.config.ts:20` |
| 20 | `managedCardSyncKey` は `<li>` の React key であり、mnemonic を含まない。mnemonic 保存は `cards.updated_at` を動かさないので、現状のままでは保存後に行が再マウントされない | `AiCardManagementClient.tsx:43-54,329` |
| 21 | `attachIllustrationUrls` は項目を `{...item}` で複製するため、新フィールドはそのまま通過する | `frontend/src/lib/ai-card-management/illustration-urls.ts:75-85` |

### 訂正

- **R-1**: issue の Current State #11 は「学習画面は `status='approved'` の explanation を表示済み」と記載しているが、
  `fetchMnemonicExplanationByKey`（`session-actions.ts:530-552`）は `owner_user_id` と `illustration_key` だけで絞り込み、
  `status` では絞っていない。現状の行が全て `'approved'` であるため観測上の差は無い。
  本 Story は `status='approved'` を書くため AC-4 の成立に影響しない。`status` 絞り込みの追加は本 Story では行わない
  （表示側の契約変更になり、issue のスコープ外）。

## 3. 受入条件（AC）

issue #64 の 17 項目をそのまま採用する。検証方法を各項目へ明示する。

- **AC-1**: `/ai/cards` の各カードに承認済み mnemonic の入力 7 項目が表示される。内訳は `slots.kanji`、
  `slots.isSingleKanji`、`slots.shapeHint.part`、`slots.shapeHint.picture`、`slots.meaningHint`、`slots.story`、
  `explanation.summary`。加えて `explanation.mappings` の各 `{part, meaning}` 組が全件表示される。
  検証: `AiCardManagementClient.test.tsx` の静的マークアップ検査。
- **AC-2**: `mnemonic` が `null` のカードは「未設定」と表示され、編集フォームが出ない。検証: 同上。
- **AC-3**: 編集して保存すると `card_mnemonics` が `status='approved'` で更新され、リロード後も保持される。
  検証: 統合テスト（実 DB への upsert → 再読込）。
- **AC-4**: 保存した `explanation.summary` が学習画面の `data-testid="mnemonic-explanation-summary"` に反映される。
  検証: 統合テストで `card_mnemonics.explanation` の更新を確認し、表示側は既存経路（`session-actions.ts:711` →
  `MnemonicExplanation.tsx`）が無変更であることを根拠とする。なお `shouldRenderMnemonicExplanation` は
  `illustrationStatus === "ready"` を要求するため、表示されるのはイラストが ready のカードに限られる（既存挙動）。
- **AC-5**: 上限違反（kanji 17 文字 / text 101 文字 / summary 121 文字 / mappings 1 件 / mappings 5 件）はすべて
  保存前に拒否され、`card_mnemonics` へ書き込みが発生しない。クライアント判定は `isMnemonicEntryValid` を再利用する。
  サーバ側は既存サニタイザ（前提 #15）を共有して同じ上限を強制する（ADR-013 決定事項 4）。
  検証: `isMnemonicEntryValid` の 5 種 unit test ＋ service 層の拒否 unit test（repository 未呼出を assert）。
- **AC-6**: 呼び出し元が所有していない `cardId`、または `cardId` と一致しない `illustrationKey` を渡した保存は
  Server Action の所有権検証で `NOT_FOUND` になり、`card_mnemonics` に行が作られず既存行の更新も発生しない。
  RLS でも拒否される（二重）。検証: service 層 unit test ＋ 実 DB 統合テスト。
- **AC-7**: `mnemonicSharedCardCount` が 2 以上のカードで共有枚数が表示され、1 のカードでは表示されない。
  カウントは現在ページに載っていない共有カードも含む。検証: 静的マークアップ検査 ＋ 実 DB 統合テスト（ページ跨ぎ）。
- **AC-8**: MCP の `list_ai_cards` 応答が現行と同一である。キー集合・キー順序・値の型・`null` の扱いすべてを対象とし、
  変更前の応答に対する deep-equal スナップショットで検証する。`illustrationKey` / `mnemonic` /
  `mnemonicSharedCardCount` はいずれも含まれない。
- **AC-9**: `list_ai_managed_cards` の owner が `s10_migration_owner` のまま、`authenticated` の EXECUTE 権限も
  維持されている。検証: migration contract test（SQL 静的検査）＋ 実 DB 統合テスト（`pg_proc` 確認）。
- **AC-10**: 保存中は既存の `処理中です…` 表示が出て操作が無効化され、成功時は成功 `notice`、失敗時は
  `role="alert"` のエラー `notice` が出る。挙動は既存の「本文を保存」「タグを保存」と同一。
  検証方法の制約は下記 R-2 を参照。
- **AC-11**: `/decks/[deckId]/ai/new` の承認フローの挙動は変わらない（既存テストが緑）。
- **AC-12**: `/ai/cards` にイラスト選択の `select` と「イラストを保存」ボタンが存在しない。
  `setAiCardIllustrationAction` も存在しない。
- **AC-13**: `/ai/cards` にイラストのサムネイル表示は残っており、`ready` のイラストが引き続き画像として見える。
- **AC-14**: `/ai/cards` に「登録バッチを取り消す」ボタンが存在しない。
- **AC-15**: UI 削除後も Remote MCP の `update_ai_card`（`illustrationId` 指定）と `undo_import_batch` が
  従来どおり動作する。`set_card_illustration` / `undo_import` RPC、`service.ts` の `setIllustration`、
  両 repository の実装はいずれも残っている。
- **AC-16**: `getAiCardManagementOptionsAction` の戻り値に `illustrations` が含まれない。
  デッキとタグの選択肢は従来どおり返る。
- **AC-17**: `npm --prefix frontend run check` が通る（前提 #19 の env 起因失敗を除く）。

### 検証方法の制約

- **R-2（AC-10）**: このリポジトリには DOM テスト環境が無い（前提 #18）。クリックを発火して
  「保存中 → 成功／失敗」の遷移を観測する試験は、`@testing-library/react` と jsdom の追加が前提になる。
  依存追加は `.claude/rules/core-principles.md` の停止・確認対象であり、issue #64 のスコープ外。
  よって AC-10 は次の 3 点で検証する。
  1. ニーモニック保存が既存 `applyMutation` を経由し、独自の pending / notice state を持たないこと（実装制約・レビュー）。
  2. ニーモニック UI が `処理中です…` / `notice` の描画要素を増やさないこと。静的レンダリングでは pending も notice も未発生の初期状態しか作れないため、
     「ニーモニック行を複数描画しても `処理中です…`・`role="status"`・`role="alert"` が 0 件のまま」かつ「`aria-busy` を持つ容器が 1 つだけ」を assert する
     （実装レビュー後に検証手段を実態へ合わせて確定。件数 assert の対象を「1 つだけ」から「増えないこと」へ改めた）。
  3. `mutationsDisabled` が真になる props（`initialError` 非 null）で保存ボタンが `disabled` になること（静的マークアップ検査）。
  加えて、pending 遷移そのものは既存 `exclusive-operation.test.ts` が対象済み。
  DOM 依存の追加が必要と判断された場合は別 issue として提起する。

## 4. 非機能要件

- セキュリティ: ADR-013 決定事項 6 の三層（認証 / 所有権 / RLS）を満たす。`owner_user_id` は
  セッション由来で固定し、client 入力から取らない。`storage_path` と署名 URL の扱いは S-18 の現行契約を変えない。
- 性能: 一覧 1 ページ（最大 20 行）に対し LATERAL 2 つを追加する。共有枚数カウントは
  `idx_cards_illustration_key` を使える（前提 #14）。新規 index は追加しない。
- 互換性: RPC のシグネチャを変更しない。MCP のツール契約（入出力の形）を変更しない。
- 運用: migration 未適用のままアプリを配備した場合でも一覧が壊れないこと（新フィールドは
  「無ければ既定値・有れば厳格検証」で parse する。ADR-013 実装への指針）。

## 5. 記録事項（挙動を変えないが明示する）

- ニーモニック編集は `card_mnemonics` へ直接書くため、`ai_import_items.user_edited_at` は立たない。
  この印を立てるのはカード変更 RPC 群のみである（`20260714000000_s10_....sql:2152,2247,2446`、
  `20260719000001_s13_....sql:486`）。
- 本 Story で UI からバッチ取り消しを外すため、UI 経由でニーモニック編集分が消える動線は無くなる。
  ただし Remote MCP 経由の `undo_import_batch` では依然として消える。
  将来 UI にバッチ取り消しを戻す場合は、ニーモニック編集も `user_edited_at` を立てるか、
  取り消し前に警告を出すかを決める必要がある。

## 6. Rollback

1. アプリ層（サーバ層 + UI + MCP 境界）は PR revert で戻す。
2. DB は forward migration `supabase/migrations/20260726000001_s19_revert_ai_card_mnemonic_edit.sql` を新規追加し、
   `list_ai_managed_cards` を `9134703` 時点の定義で `CREATE OR REPLACE` して戻す。適用は `supabase db push`。
   この revert migration は本 PR には含めない（含めると即座に打ち消す）。

シグネチャを変えないため owner と ACL は両方向で保持される。データ破壊は無い
（新規テーブル・新規列・データ変換なし。`card_mnemonics` は既存行の更新のみ）。
