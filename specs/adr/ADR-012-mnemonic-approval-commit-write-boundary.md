---
id: ADR-012
feature: mnemonic-approval-commit-write-boundary
type: adr
version: 1.0.0
created: 2026-07-22
updated: 2026-07-22
status: Accepted
based_on: specs/stories/S-16D-approval-ui/requirements.md
related_epic: E-16
related_story: specs/stories/S-16D-approval-ui/story.md
---

# ADR-012: 承認済みニーモニックは app_ai commit RPC の同一トランザクション内で card_mnemonics へ書き込む

## ステータス

Accepted

## コンテキスト

E-16 のハイブリッド方針（AI 下書き → 人が承認）において、S-16C は OpenAI 生成の `mnemonicDraft`（concept 単位の `slots` / `explanation`）を preview envelope へ載せて返す。S-16D は、この下書きを既存 AI カードインポート UI（`AiCardImportClient`）で人が編集・承認し、commit 時に owner スコープで `card_mnemonics`（`(owner_user_id, illustration_key)`、`status='approved'`）へ確定保存する責務を負う。保存された行は S-16E（画像生成）・S-16F（答え側の説明表示）へ「人がレビュー済みの確定データ」として渡る。

ここで書き込み先の主キーである `illustration_key` の性質が設計を強く制約する（コード実測 2026-07-22）。

- `illustration_key` は commit RPC の内側で `'s11:' || batchId || ':' || sha256hex(conceptId)` として materialize される（`supabase/migrations/20260715000000_s11_ai_card_async_processing.sql` の `commit_import_async` concept ループ、illustration 行 INSERT 部）。`batchId` は commit ごとにランダムな UUID であり、client には確定できない。
- `image_mode='none'` の concept は illustration 行を作らず `illustration_key=NULL` になる（＝ card_mnemonics の書き込み対象外）。
- commit 自体は非同期で、RPC は 202 `{batchId,status:'queued'}` を返しカードは worker が後作成するが、illustration 行（＝ key の実体）は commit RPC 内で同期作成される。
- UI 経路の外側 wrapper は `commit_generated_import_async(uuid,text,text,jsonb,text)`（`supabase/migrations/20260718000006_commit_generated_import_after_exclusions.sql`）で、これを呼ぶのは cookie 認証の `frontend/src/lib/ai-import/app-ai-repository.ts` のみ。Remote MCP は別経路 `s14_remote_commit_import` → `ai_s14_enqueue_import_internal` を通る。
- preview-token（`frontend/src/lib/ai-import/preview-token.ts`）は `{v,userId,reservationKey,importRequestHash,expiresAt}` の厳密 5 キーを HMAC-SHA256 署名する。`importRequestHash` は deck + items（clientItemId/conceptId/pattern/front/back/tags/image）を被覆するが **mnemonic 内容は被覆しない**。S-14（ADR-011）でこの token 契約と DB 側の再検証が確立している。
- `card_mnemonics`（`supabase/migrations/20260721000001_s16_card_mnemonics.sql`）は `(owner_user_id, illustration_key)` UNIQUE、`illustration_key text NOT NULL`、owner-scoped RLS（select/insert/update）、`status IN ('draft','approved')`。

したがって「どこで」「どのデータ搬送で」書き込むかは、`illustration_key` の確定タイミングと preview-token 契約の不変性という 2 つの既存境界に整合させて決める必要がある。誤ると、key 不確定による書き込み不能、非原子な二経路書き込みによる不整合、あるいは token 契約破壊による UX 退行（編集ごとの再 preview 強制）を招く。

## 決定事項

### 1. 書き込みは app_ai commit RPC `commit_generated_import_async` の同一トランザクション内で行う

card_mnemonics への upsert は、UI 経路専用 wrapper `commit_generated_import_async` を新 migration で拡張し、その内部（＝ illustration 行が materialize される内側 `commit_import_async` を呼んだ後、同一関数トランザクション内）で実行する。client 事前計算でも commit 後の別 Server Action でもない。

- `illustration_key` は client 未確定（`batchId` がサーバ採番）であり、非同期 commit 後の別 Server Action は「key を再解決してから別トランザクションで書く」ことになり原子性を失う。
- RPC は `SECURITY DEFINER` の単一トランザクションであり、illustration 行と card_mnemonics 行を all-or-nothing で確定できる。commit がロールバックすれば mnemonic 書き込みもロールバックする。

### 2. illustration_key は「捏造した式」ではなく materialize 済み行から解決する

upsert 対象の `illustration_key` は、`commit_import_async` が返す `batchId` を用いて `ai_import_concept_jobs`（batch_id, concept_id, illustration_id）→ `illustrations`（id, illustration_key）を owner スコープで join し、実際に materialize された値を取得する。key 生成式（`'s11:'||batchId||':'||sha256hex(conceptId)`）を wrapper 側へ複製しない。

- key 生成規則の二重定義を避け、regime 変更時の drift を防ぐ。
- join で解決できない concept（`image_mode='none'` で illustration 行なし、または request に存在しない `conceptId`）は upsert 対象から除外（skip）する。
- 冪等再 commit（既存 batch 検出）でも同じ `batchId` から同じ key が解決されるため、`ON CONFLICT (owner_user_id, illustration_key) DO UPDATE` で二重化せず反映される。

### 3. Remote MCP 経路の共有 primitive `commit_import_async` は変更しない

mnemonic 対応は app_ai 専用 wrapper `commit_generated_import_async` に閉じる。内側の共有 primitive `commit_import_async`（Remote MCP も経由）にはニーモニック引数を追加しない。S-16D は app_ai / cookie 認証経路のみを対象とし、Remote MCP 経由の承認はスコープ外であることをこの境界で担保する。

- wrapper の signature に新 optional 引数 `p_mnemonics jsonb DEFAULT NULL` を追加する。既存呼出（現状は app UI のみ）と将来の非承認 commit は NULL のまま従来挙動を保つ。
- signature 変更は overload 増殖を避けるため `DROP FUNCTION` → `CREATE FUNCTION`（新 6 引数）で行い、`ALTER FUNCTION ... OWNER TO s10_migration_owner`・REVOKE・GRANT・固定 `search_path` を同一 migration に含める。

### 4. mnemonic は preview-token に相乗りさせず commit body の独立フィールドで搬送する

mnemonic は token payload（5 キー shape）にも `importRequestHash` 被覆範囲にも含めない。commit body の独立フィールド `mnemonics: [{conceptId, slots, explanation}]` として送る。preview-token の 5 キー shape と hash 被覆範囲は一切変更しない。

- 承認 UI は preview 後に mnemonic を編集する。hash が mnemonic を被覆すると編集ごとに再 preview が必要になり、UX と S-14 で確立した token/hash 契約を壊す。
- token は import request（カード集合）の完全性のみを保証し続け、mnemonic の正当性は別レイヤ（決定事項 5）で担保する。

### 5. mnemonic の owner は認証セッション由来で固定し、内容はサーバで独立に再検証・再サニタイズする

- owner は client 指定を受け付けず、必ず `p_actor_user_id`（＝認証ユーザー）で固定する。
- `conceptId` は署名済み request（`validateImportRequest` 済み・`importRequestHash` 被覆）の items に存在するものだけを許可する。
- 全テキストへ `normalizeDisplayText`（NFKC）を適用し、S-16C 由来の length-cap（`slots.kanji` 1–16、`shapeHint.part`/`picture`・`meaningHint`・`story` 各 1–100、`explanation.summary` 1–120、`mappings[].part`/`meaning` 各 1–100）と `mappings` 件数 2–4 をサーバ側で強制する。範囲外は `VALIDATION_ERROR` で拒否する。
- この再検証は TS commit service（`frontend/src/lib/ai-import/service.ts`）を第一境界とし、RPC は構造ガード（`p_mnemonics` が array であること）と owner スコープ join を最終境界とする。

### 6. セキュリティ三層への適合

- **認証**: commit route で `auth.getUser()` により認証必須（既存踏襲）。
- **所有権**: mnemonic の owner は認証セッション由来で固定（決定事項 5）。書き込みは `SECURITY DEFINER` 関数内で `p_actor_user_id` を明示指定する（既存 illustrations 書き込みと同一パターン）。
- **RLS**: `card_mnemonics` の owner-scoped RLS を最終防衛線として維持する。S-16F の直接 read や client アクセスはこの RLS で cross-user を遮断する。tamper された mnemonic 内容が到達しても影響は本人の `card_mnemonics` 行に限定される。

## 根拠と選択肢

### 選択肢1（採用）: commit RPC 内・同一トランザクションで materialize 済み key へ upsert ＋ commit body 独立搬送

- 利点: `illustration_key` の確定タイミングと原子性を両立。preview-token 契約を不破壊。Remote MCP 共有 primitive に非干渉。冪等。
- 欠点: app_ai wrapper の signature 変更（DROP/CREATE）と DB 型更新が必要。書き込みが `SECURITY DEFINER` 経由になり RLS を迂回するため、owner を関数内で厳密固定する規律が要る。

### 選択肢2: client が illustration_key を事前計算して commit body に含める

- 利点: 書き込みを別 Server Action / RPC に外出しでき、wrapper を変更せずに済む。
- 欠点: `batchId` が commit ごとサーバ採番のため client は key を確定できない。key を捏造すれば別 concept と衝突・誤上書きのリスク。実現不能。

### 選択肢3: commit 成功後に別 Server Action で key を再解決して書き込む

- 利点: RPC を触らず TS 側で完結。
- 欠点: illustration 確定と mnemonic 書き込みが別トランザクションになり非原子。commit 成功／mnemonic 失敗の不整合、worker との競合、部分的 approved 状態を招く。冪等性・整合性の担保コストが高い。

### 選択肢4: mnemonic を preview-token / importRequestHash に被覆させて搬送する

- 利点: 搬送データの完全性を既存 HMAC で一括保証できる。
- 欠点: 承認 UI の mnemonic 編集ごとに hash が変わり再 preview を強制。S-14（ADR-011）で確立した token 5 キー shape / hash 被覆範囲の契約を破壊し、Remote MCP 側の DB 再検証（`s14_remote_commit_import`）とも非互換になる。

| 評価軸 | 採用案(1) | client 事前計算(2) | commit 後別 Action(3) | token 相乗り(4) |
|---|---:|---:|---:|---:|
| key 確定可能性 | 高 | 不能 | 中 | 高 |
| 原子性・冪等性 | 高 | 低 | 低 | 中 |
| preview-token 契約の保全 | 高 | 高 | 高 | 破壊 |
| Remote MCP 非干渉 | 高 | 高 | 中 | 低 |
| owner/RLS 境界の明確さ | 高 | 低 | 中 | 中 |

## 影響

### ポジティブ

- 「人が承認した確定データ」を原子的・冪等に保存でき、S-16E/S-16F が信頼できる入力を得る。
- preview-token と `importRequestHash` の契約を無変更に保ち、S-12/S-14 の既存経路と Remote MCP を退行させない。
- mnemonic 書き込みが app_ai wrapper に閉じるため、Remote MCP 承認という別スコープを混入させない。

### ネガティブ

- `commit_generated_import_async` の signature 変更（DROP/CREATE）と `frontend/src/types/database.ts` の RPC 型更新が必要。適用時は関数 owner を catalog で再確認する（common-failure #17）。
- `SECURITY DEFINER` 経由書き込みは owner-scoped RLS を迂回するため、owner 固定の規律と、owner ロールが `card_mnemonics` を書ける前提（既存 illustrations 書き込みと同条件）を migration と int test で確認する必要がある。
- commit トランザクションに upsert が加わり、大量 concept 時にわずかに処理時間が増える（既存 illustration ループと同オーダー）。

### 中立

- Remote MCP 経由の承認は将来別 Story / 別 ADR の対象として残る。本 ADR はその経路を意図的に対象外とする。
- 未承認 concept は `card_mnemonics` 行を持たず、S-16E の画像生成対象から自然に外れる（`image='ai'` かつ未承認は UI で明示）。

## 実装への指針

- mnemonic の owner は決して client 入力から取らず、認証済み actor で固定する。
- `conceptId` は署名済み request の items に存在するものだけを受理し、未知 `conceptId` は静かに無視せずサーバで拒否または skip の方針を一貫させる。
- 保存前サニタイズ（NFKC＋length-cap＋mappings 2–4）は TS service を第一境界とし、RPC は構造ガードと owner スコープ join を最終境界とする。二重の責務を明示する。
- migration timestamp は並行スプリントの prefix 衝突を避け、既存最大（`20260721000001`）より確実に後（`20260722...` 以降）を採番する。
- 関数 owner・grant・RLS 迂回条件は SQL 本文の静的確認で終わらせず、隔離 DB の `pg_proc` / actor 別 int test で確認する。

## 関連情報

- `specs/adr/ADR-007-ai-card-import-foundation.md`
- `specs/adr/ADR-008-ai-card-async-queue-image-processing.md`
- `specs/adr/ADR-010-ai-card-preview-source-status-ui-boundary.md`
- `specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md`（preview-token/hash 契約と DB 再検証の正本）
- `specs/stories/S-16C-ai-mnemonic-draft/design.md`（`mnemonicDraft` 搬送・`conceptId` join key の正本）
- `specs/stories/S-16D-approval-ui/requirements.md` / `story.md`
- 実測ソース: `supabase/migrations/20260715000000_s11_ai_card_async_processing.sql`、`supabase/migrations/20260718000006_commit_generated_import_after_exclusions.sql`、`supabase/migrations/20260721000001_s16_card_mnemonics.sql`、`frontend/src/lib/ai-import/{service,app-ai-repository,preview-token,schema,normalize}.ts`

## 変更履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-07-22 | 1.0.0 | 初版。commit RPC 同一トランザクション内書き込み、materialize 済み key 解決、Remote MCP primitive 非干渉、token 非相乗り＋独立搬送、owner 固定＋サーバ再検証、セキュリティ三層適合を決定 |
</content>
</invoke>
