---
id: ADR-013
feature: post-commit-mnemonic-edit-write-boundary
type: adr
version: 1.0.0
created: 2026-07-26
updated: 2026-07-26
status: Accepted
based_on: specs/stories/S-20-ai-cards-mnemonic-edit/requirements.md
related_epic: E-16
related_story: specs/stories/S-20-ai-cards-mnemonic-edit/story.md
---

# ADR-013: 登録後のニーモニック編集は owner-scoped RLS 経由の直接 upsert で行い、新しい特権書き込み口を作らない

## ステータス

Accepted

## コンテキスト

ADR-012 は「承認済みニーモニックの**初回書き込み**」を、app_ai commit RPC `commit_generated_import_async` の同一トランザクション内で行うと決めた。理由は `illustration_key` が commit RPC の内側で初めて materialize される（`batchId` がサーバ採番）ためであり、「commit 成功後に別 Server Action で key を再解決して書き込む」案（選択肢 3）は **illustration 行の作成と mnemonic 書き込みが別トランザクションになる非原子性**を理由に却下された。

S-20（issue #64）が要求するのは、その後の局面である。`/ai/cards`（AIカード管理）に登録済みカードのニーモニックを表示し、後から直せるようにする。ここでの前提は ADR-012 の時点と決定的に違う（2026-07-26、`9134703` で実測）。

- `illustration_key` は既に materialize 済みで `public.cards.illustration_key` に永続化されている。一覧 RPC `list_ai_managed_cards` は既に `illustrations.illustration_key = cards.illustration_key` で join しており（`supabase/migrations/20260719000001_s13_ai_card_management_undo.sql:124-127`）、key はサーバ側で確定値として読める。client の事前計算も key の再解決も不要。
- 書き込み対象は既存 1 行の更新（または同 key の初回作成）のみで、同時に作成・変更する他テーブルの行が存在しない。**原子性を要する複合書き込みが無い**ため、ADR-012 選択肢 3 の却下理由は本局面には当てはまらない。
- `public.card_mnemonics` は owner の SELECT / INSERT / UPDATE ポリシーと `GRANT SELECT, INSERT, UPDATE ... TO authenticated` を既に持つ（`supabase/migrations/20260721000001_s16_card_mnemonics.sql:24-41`）。owner 本人の cookie セッションからの upsert に必要な権限は**既に揃っている**。
- `card_mnemonics` の owner は `s10_migration_owner`（`supabase/migrations/20260724000000_s16_card_mnemonics_owner_fix.sql`）。table owner は RLS をバイパスするため、既存の `SECURITY DEFINER` 経路も引き続き動く。
- UNIQUE 制約は `(owner_user_id, illustration_key)` で、`card_id` 列は無い。1 つの `illustration_key` を複数カードが共有しうるため、mnemonic 行はカード 1 枚と 1:1 対応しない。

したがって決めるべきは、(1) 追加の書き込み口を DB 側に新設するか否か、(2) 所有権をどう検証するか、(3) 同時編集の競合をどう扱うか、(4) この経路を Remote MCP へ露出するか、の 4 点である。

## 決定事項

### 1. 新しい RPC を作らず、owner-scoped RLS 経由の直接 upsert で書く

`public.card_mnemonics` へ `onConflict: (owner_user_id, illustration_key)` の upsert を、cookie 認証の Server Action が持つ通常の（`SECURITY DEFINER` ではない）Supabase client から直接発行する。`status` は `'approved'` を書く。新しい RPC も新しい `GRANT` も追加しない。

- 必要な権限・ポリシーは既に存在する（コンテキスト参照）。新設は攻撃面と保守対象を増やすだけで得が無い。
- `SECURITY DEFINER` 関数は RLS を迂回するため、owner を関数内で厳密固定する規律が常に要る（ADR-012 選択肢 1 の欠点として明記済み）。RLS 経由の直接書き込みは `auth.uid() = owner_user_id` が**構造的に**効くので、その規律を人手で維持する必要が無い。
- `owner_user_id` は client 入力から取らず、必ず `auth.getUser()` 由来のセッション値を書く（ADR-012 決定事項 5 の owner 固定原則をそのまま踏襲）。

### 2. 所有権は「cardId と illustrationKey の一致」をサーバで先に 1 クエリ検証する

Server Action は `cardId` と `illustrationKey` の両方を受け取り、書き込み前に次を確認する。

```sql
select id from public.cards
where id = :cardId and owner_user_id = :sessionUserId
  and illustration_key = :illustrationKey
```

不在・不一致なら `NOT_FOUND` を返し、`card_mnemonics` へは一切書かない。RLS は最終防衛線として残す（二重）。

- `card_mnemonics` の RLS は「その行が呼び出し元のものか」しか見ない。`illustration_key` は client 由来の文字列なので、RLS だけでは**呼び出し元自身の別カードの mnemonic を書き換える**ことを防げない。UI が編集対象として提示したカードと key の対応をサーバで確認して初めて、操作意図と書き込み先が一致する。
- `cards` 側の owner 検証を明示述語で書き、RLS にも重複して依存させる（`.claude/rules/core-principles.md` の三層防御に整合）。

### 3. 競合は last-write-wins とし、`expectedUpdatedAt` 方式は採らない

既存の本文更新 `update_imported_card` は `p_expected_updated_at` による楽観ロックを持つが、ニーモニック編集には持ち込まない。

- `card_mnemonics` の行は `illustration_key` 単位で複数カードに共有されうるため、カード単位の `cards.updated_at` と 1:1 対応しない。カードの `updatedAt` を条件にすると、共有相手のカードを編集しただけで無関係な CONFLICT が出る。
- 個人利用前提で同一 key の同時編集は起きないと判断する（本 ADR のスコープ判断として記録）。
- 後から楽観ロックを足す場合は `card_mnemonics.updated_at` を条件に使う。`set_card_mnemonics_updated_at` トリガが既に値を維持しているので、契約追加だけで実装できる。

### 4. 内容の再検証は commit 経路と同一のサーバ側サニタイザを共有する

`slots` / `explanation` は保存前にサーバで NFKC 正規化と length-cap（`slots.kanji` 1–16、`shapeHint.part` / `picture` / `meaningHint` / `story` 各 1–100、`explanation.summary` 1–120、`mappings[].part` / `meaning` 各 1–100、`mappings` 件数 2–4）を強制し、範囲外は `VALIDATION_ERROR` で拒否する。判定ロジックは commit 経路（`frontend/src/lib/ai-import/service.ts` の `sanitizeMnemonicSlots` / `sanitizeMnemonicExplanation`）を**共有モジュールへ抽出して再利用**し、複製しない。

- ADR-012 決定事項 5 は「内容はサーバで独立に再検証・再サニタイズする」ことを card_mnemonics への書き込み一般の要件として定めている。書き込み経路が増えても要件は同じであり、クライアント側の承認ゲート（`isMnemonicEntryValid`）は UI の補助にすぎない。
- 二重定義は上限値の drift を生む。commit 経路と編集経路で許容値が食い違うと、承認時に通った内容が編集時に落ちる（またはその逆）という説明不能な挙動になる。

### 5. この書き込み経路を Remote MCP へ露出しない

書き込みは `AiCardManagementRepository`（UI と Remote MCP が共有する interface）へ追加せず、別の narrow interface と別の factory として持つ。Remote MCP の repository はこれを実装しない。

- 共有 interface へ追加すると Remote MCP 側にも実装義務が生じ、境界の判断がコードから読み取れなくなる。別 interface なら「MCP は構造上呼べない」ことが型で表現される。
- Remote MCP からのニーモニック書き込みは S-20 のスコープ外（issue #64 Out of Scope）。将来公開する場合は S-14 の `s14_remote_*` wrapper 群と同じ client / session 再検証を通す必要があり、そのとき改めて決める。

### 6. セキュリティ三層への適合

- **認証**: `createAuthenticatedBoundary()` で `auth.getUser()` 必須（既存 Server Action 踏襲）。feature flag `AI_CARD_MANAGEMENT_ENABLED` も既存どおり先に評価する。
- **所有権**: 決定事項 2 の `cards` 明示述語による事前検証。`owner_user_id` はセッション由来で固定（決定事項 1）。
- **RLS**: `card_mnemonics` の owner-scoped policy を最終防衛線として維持。cross-user はここで遮断される。

## 根拠と選択肢

### 選択肢1（採用）: RLS 経由の直接 upsert ＋ Server Action での所有権事前検証

- 利点: 新しい特権書き込み口を作らない。RLS が構造的に効く。migration は読み取り側（`list_ai_managed_cards`）の射影追加のみで、書き込み側の DB 変更はゼロ。切り戻しが軽い。
- 欠点: 所有権検証と upsert が別クエリになる（アプリ層 2 往復）。両者の間に対象カードが消えても RLS と UNIQUE の範囲で無害だが、厳密な原子性は無い。

### 選択肢2: `authenticated` 実行可の `SECURITY DEFINER` RPC を新設して書く

- 利点: 所有権検証と upsert を 1 トランザクションに閉じられる。既存 S-13 管理 RPC 群と形が揃う。
- 欠点: RLS を迂回する新しい書き込み口が増え、owner 固定の規律を関数内で人手維持することになる。migration に owner / REVOKE / GRANT / `search_path` 固定を一式追加する保守コストが、原子性の実利（共有行の単純更新）に見合わない。切り戻しも重くなる。

### 選択肢3: 既存 `commit_generated_import_async` を拡張して編集も通す

- 利点: ADR-012 の書き込み口を単一に保てる。
- 欠点: 当該 wrapper は import commit の入口であり、編集はカード集合の commit を伴わない。preview-token・`importRequestHash`・冪等キーといった commit 前提の入力を編集のために偽装する必要が出る。境界の意味が壊れる。

### 選択肢4: `expectedUpdatedAt` による楽観ロックを付ける

- 利点: 同時編集の上書きを検出できる。
- 欠点: 共有行に対してカード単位の `updatedAt` を条件にすると誤検出する（決定事項 3）。`card_mnemonics.updated_at` を新たに UI へ搬送する契約追加が必要で、単独利用前提の現状では過剰。

## 影響

### ポジティブ

- `ai_illustration_objects` のような「特権 RPC 新設が必要な領域」に踏み込まずに編集機能を出せる。
- DB 変更が読み取り射影だけになるため、切り戻しは `list_ai_managed_cards` を旧定義で `CREATE OR REPLACE` する forward migration 1 本で済む。
- commit 経路と編集経路のサニタイズが 1 箇所になり、上限値の drift が構造的に起きなくなる。

### ネガティブ

- 所有権検証と書き込みが別トランザクションになる。検証通過後に対象カードが削除された場合、mnemonic 行だけが残る（既存の `illustration_key` 単位の孤児行と同じ状態で、表示経路は key 一致でしか読まないため実害は無い）。
- last-write-wins のため、将来複数デバイス同時編集が要件になったら契約追加が必要になる。

### 中立

- `ai_import_items.user_edited_at` は立たない。カード変更 RPC 群のみがこの印を付けるため、ニーモニック編集は「未編集カード」の判定に影響しない。S-20 では UI からバッチ取り消しを外すので UI 経由で編集分が消える動線は無くなるが、Remote MCP の `undo_import_batch` では依然として消える。この事実は S-20 の requirements に記録し、挙動自体は変えない。

## 実装への指針

- `list_ai_managed_cards` の差し替えは `DROP` せず `CREATE OR REPLACE` で行う。引数名・引数型・既定値・戻り型は 1 文字も変えない（`CREATE OR REPLACE` は引数名の変更と戻り型の変更を拒否する）。owner と ACL は replace で保持されるが、防御的に `ALTER FUNCTION ... OWNER TO s10_migration_owner` と `REVOKE ALL ... / GRANT EXECUTE ... TO authenticated` を同一 migration で再発行し、状態を決定的にする。
- 新フィールドは Remote MCP 応答へ出さない。MCP 境界では**許可リスト射影**（出すキーを列挙する）を使い、除去リスト方式は使わない。後で `ManagedAiCard` に項目が増えても自動で漏れない形にする。
- 一覧レスポンスの parse は「無ければ既定値・有れば厳格検証」にする。migration 適用前のアプリ配備（skew）で一覧全体が壊れることを防ぐ。
- migration timestamp prefix は既存最大（`20260725000000`）と重複させない。同一 prefix は `supabase db push` に黙って読み飛ばされる。

## 関連情報

- `specs/adr/ADR-012-mnemonic-approval-commit-write-boundary.md`（初回書き込み境界の正本。本 ADR はその後続局面を扱う）
- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- `specs/adr/ADR-007-ai-card-import-foundation.md`
- `specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md`
- `specs/stories/S-20-ai-cards-mnemonic-edit/`
- 実測ソース: `supabase/migrations/20260719000001_s13_ai_card_management_undo.sql`、`supabase/migrations/20260721000001_s16_card_mnemonics.sql`、`supabase/migrations/20260724000000_s16_card_mnemonics_owner_fix.sql`、`frontend/src/lib/ai-card-management/*`、`frontend/src/lib/ai-import/service.ts`、`frontend/src/lib/mcp/services.ts`

## 変更履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-07-26 | 1.0.0 | 初版。RLS 経由直接 upsert、cardId/illustrationKey 一致の事前検証、last-write-wins、サニタイザ共有、Remote MCP 非露出、三層適合を決定 |
