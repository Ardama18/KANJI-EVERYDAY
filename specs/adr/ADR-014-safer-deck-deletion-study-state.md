---
id: ADR-014
story_id: S-29
title: safer-deck-deletion-with-study-state
epic_id: E-02
type: adr
version: 1.0.0
created: 2026-08-01
status: Accepted
based_on: specs/stories/S-29-safer-deck-deletion-with-study-state/requirements.md
feature: safer-deck-deletion-with-study-state
related_stories:
  - specs/stories/S-29-safer-deck-deletion-with-study-state/
  - specs/stories/S-25-deck-deletion/
related_adr:
  - specs/adr/ADR-002-database-schema-rls-access-boundary.md
  - specs/adr/ADR-005-study-session-flow.md
---

# ADR-014: 学習状態を保持したままデッキ削除時に未完了セッションを終了する

## ステータス

Accepted

## コンテキスト

S-25 は `decks.deleted_at` による論理削除を導入し、未完了 `study_sessions.finished_at IS NULL` が存在する場合は Server Action と DB trigger `guard_deck_logical_delete_active_session()` の両方で削除を拒否した。S-29 はこの契約を後続 story として上書きし、owner 本人が `review_states` や完了/未完了 `study_sessions` を持つ deck でも削除できるようにする。

ただし ADR-005 は `study_sessions` を学習進行の単一ソースとし、`rateCard` が `review_states` と session queue を更新する契約を持つ。削除済み deck に紐づく古い session から再開、回答表示、評価保存ができると、削除済み deck が通常学習対象に戻ったように見え、`review_states` の副作用も起きる。削除は履歴削除ではないため、`deck_cards`、`review_states`、`study_sessions`、`cards` の物理削除もできない。

## 決定ドライバー

- S-29 Must: owner は復習状態や学習履歴がある deck でも削除できる。
- S-29 Must/Won't: deck 削除は `decks.deleted_at` の論理削除を維持し、関連テーブルは物理削除しない。
- ADR-005: `study_sessions` は再開可能な学習状態の正本であり、Server Actions からのみ更新する。
- セキュリティ: Server Action と DB の両方で認証・owner 境界を持ち、service role は通常 owner CRUD に使わない。
- データ整合: deck tombstone と未完了 session 終了を同一トランザクションで扱う。

## 検討案

### 案A: S-25のactive session削除拒否を維持する

- 概要: 未完了 session があれば削除を拒否し、利用者に学習完了後の削除を求める。
- 利点:
  - ADR-005 の再開契約を変更しない。
  - S-25 実装と trigger をほぼ維持できる。
- 欠点:
  - S-29 の AC-05「未完了 `study_sessions` が存在しても削除できる」を満たせない。
  - `review_states` ではなく active session が削除不能の主因である現行不具合を解消しない。

### 案B: deckだけを論理削除し、session操作側で削除済みdeckを拒否する

- 概要: DB trigger を削除し、`deleteDeck` は `decks.deleted_at` だけを更新する。未完了 session は `finished_at IS NULL` のまま保持し、`getNextCard` / `revealCard` / `rateCard` で都度 deck active を確認する。
- 利点:
  - 実装量が比較的少ない。
  - `study_sessions` row を物理削除せず履歴として残せる。
- 欠点:
  - 未完了 session が DB 上は active のまま残り、将来の集計や再開判定で誤解を生みやすい。
  - deck tombstone と session 遮断が別境界になり、guard 漏れがあると削除済み deck から副作用が起きる。

### 案C: Server Actionで複数UPDATEを順次実行する

- 概要: `deleteDeck` が通常 server client で未完了 `study_sessions` を更新してから `decks.deleted_at` を更新する。
- 利点:
  - 新規 RPC を作らず TypeScript だけで完結しやすい。
  - UI への戻り値を既存 `DeckDeleteActionState` のまま維持できる。
- 欠点:
  - Supabase JS の複数 DML は同一 DB トランザクションにならない。
  - session 終了に成功し deck 更新に失敗、またはその逆の部分適用が起こり得る。
  - S-25 trigger を外す場合、直接 `deleted_at` 更新経路を完全に閉じないと bypass が残る。

### 案D: owner-scoped RPCで未完了session終了とdeck論理削除を原子的に行う

- 概要: `delete_deck_with_closed_sessions(p_deck_id uuid)` RPC を追加し、JWT の `auth.uid()` 由来 actor と deck owner を DB 内で照合する。同一関数トランザクション内で未完了 `study_sessions` を `finished_at = deleted_at` にし、`current_card_id = NULL`、`revealed = false` へ閉じてから `decks.deleted_at` を更新する。Server Action は入力検証・認証・owner存在確認後、この RPC を呼ぶ。
- 利点:
  - deck tombstone と session 終了が atomic になる。
  - 未完了 session が DB 上も終了済みとなり、通常の active session 再利用経路に戻らない。
  - service role を使わず、RPC 内でも actor/owner を再検証できる。
  - 直接 tombstone 更新の bypass を `deleted_at` 列 grant の revoke と RPC grant に寄せて抑止できる。
- 欠点:
  - SECURITY DEFINER 関数の owner、固定 `search_path`、REVOKE/GRANT、Hosted owner 検証が必要。
  - TypeScript 側の Supabase Database 型と migration contract test を更新する必要がある。

## 決定

案Dを採用する。

S-29 の削除は「deck を通常学習対象から外し、未完了 session を削除時刻で終了させる」操作とする。`deck_cards`、`review_states`、`study_sessions`、`cards` は物理削除しない。未完了 `study_sessions` は削除時刻で `finished_at` を埋め、`current_card_id` を `NULL`、`revealed` を `false` に戻す。queue JSON は履歴として残し、再開・出題・回答表示・評価保存には使わない。

DB は S-25 の拒否 trigger `guard_deck_logical_delete_active_session()` を削除し、`delete_deck_with_closed_sessions(p_deck_id uuid)` を唯一の通常削除 mutation 境界にする。関数は client supplied owner を受け取らず、JWT 由来 actor を DB 内で導出する。`deleteDeck` Server Action は引き続き副作用前の deckId 検証、`auth.getUser()`、owner deck 確認を行い、RPC の失敗は安全な汎用エラーに写像する。

削除済み deck に紐づく sessionId 起点操作は、`requireSessionOwner` 後かつ `review_states` / `study_sessions` の副作用前に deck active を確認する。deck が削除済みまたは owner 不一致なら安全に失敗し、`review_states` は更新しない。

## 影響

### 利点

- 復習状態や学習履歴がある deck でも owner が削除できる。
- 未完了 session が active のまま残らず、通常の学習再開経路に戻らない。
- deck 削除と session 終了が同一トランザクションになり、部分適用を避けられる。
- 履歴 row と card row は保持されるため、将来の監査・復元 story の余地を残せる。

### 受け入れるトレードオフ

- RPC と migration contract test が増える。
- SECURITY DEFINER の運用規律が必要になる。これは既存 steering の `s10_migration_owner`、固定 `search_path`、REVOKE/GRANT、catalog 検証で管理する。
- `finished_at` を「学習完了」だけでなく「deck削除に伴う終了」にも使う。S-29 では終了理由カラムを追加せず、復元/監査 UI は Future とする。

### セキュリティとデータ

- 認証・所有権・RLS: Server Action の `auth.getUser()` と owner query、RPC 内の JWT actor/owner check、RLS を重ねる。
- server-only secret: service role key は使わない。
- migration: `guard_deck_logical_delete_active_session` trigger/function を削除し、RPC の owner/search_path/revoke/grant を同一 migration に含める。
- 物理削除: `decks`、`deck_cards`、`review_states`、`study_sessions`、`cards` の physical DELETE は追加しない。

## 実装・移行方針

- 新規 migration で S-25 trigger を drop する。
- `delete_deck_with_closed_sessions(p_deck_id uuid)` を `SECURITY DEFINER SET search_path = pg_catalog, pg_temp` で追加する。
- 関数 owner は完全 signature を指定して `s10_migration_owner` に固定し、PUBLIC / anon / service_role から revoke、authenticated に execute grant する。
- authenticated から `decks.deleted_at` の直接 UPDATE grant を revoke し、通常 deck 削除は RPC に寄せる。
- `deleteDeck` は未完了 session 事前拒否と `P1007` active-session 専用文言を削除し、RPC 成功後に `/decks` を revalidate する。
- session actions は sessionId 起点の副作用前に active deck guard を通す。
- AI import / AI card management / MCP の deck 選択・deck ID 検証は `deleted_at IS NULL` を明示する。

## 検証

- migration contract: S-25 reject trigger が削除され、RPC が owner/search_path/revoke/grant と active session close を含むこと。
- action test: review_states あり、完了/未完了 study_sessions ありでも削除成功し、RPC 呼び出しと `/decks` revalidate を検証すること。
- session action test: 削除済み deck の sessionId で `getNextCard` / `revealCard` / `rateCard` が副作用前に拒否され、`review_states` を更新しないこと。
- UI test: dialog、デッキ名 exact match、cancel、副作用なし、pending disabled、safe error、320px 相当の構造を検証すること。
- RLS/DB gate: owner 成功、他 owner / anon 拒否、関数 owner catalog、関連 row 非削除を隔離 DB で確認すること。

## 参考資料

- PostgreSQL 18 Documentation: `CREATE FUNCTION` / Writing `SECURITY DEFINER` Functions Safely. `SECURITY DEFINER` の安全な `search_path` と PUBLIC revoke の根拠。https://www.postgresql.org/docs/current/sql-createfunction.html
- Supabase Docs: Row Level Security. RLS policy には explicit filter を併用し、security definer function は慎重に扱う前提。https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Docs: Securing your API. Data API で RLS と function EXECUTE grant を明示する根拠。https://supabase.com/docs/guides/api/securing-your-api

## 関連情報

- Story: `specs/stories/S-29-safer-deck-deletion-with-study-state/`
- Design: `specs/stories/S-29-safer-deck-deletion-with-study-state/design.md`
- Supersedes in part: `specs/stories/S-25-deck-deletion/design.md` の active session 削除拒否契約
