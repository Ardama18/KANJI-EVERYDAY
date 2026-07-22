# S-16D 要件定義

## 目的

S-16C が返す `mnemonicDraft`（concept 単位の `slots` / `explanation`）を、既存 AI カードインポート UI
（`AiCardImportClient` + `AiCardForm` + `DraftCardList`）で編集・承認し、commit 時に owner スコープで
`card_mnemonics`（`(owner_user_id, illustration_key)`, `status='approved'`）へ同期 upsert する。
ハイブリッド方針（AI 下書き → 人が承認）の「人が承認」側を成立させ、S-16E（画像生成）／S-16F（説明表示）へ
人がレビュー済みの確定データを渡す。

## 検証済み現状（コード実測・2026-07-22）

- **実オーケストレータ**: `frontend/app/(auth)/decks/[deckId]/ai/new/AiCardImportClient.tsx`（"use client"）。
  preview state（`request` / `preview{importRequestHash,previewToken,previewExpiresAt,cardReservationKey}`）を保持し、
  `/api/ai/imports/commit` へ POST。`AiCardForm.tsx` は生成フォームのみ、`DraftCardList.tsx` が concept 単位で表示。
- **mnemonicDraft は現状 client で破棄**: `AiCardImportClient.parseGeneratedResult`（491-523 行）が envelope の
  `mnemonicDraft` を読まない。承認 UI へ渡すには保持する改修が必要。
- **illustration_key はサーバ採番・client 未確定**: commit RPC `commit_generated_import_async`
  （`supabase/migrations/20260715000000_s11_ai_card_async_processing.sql:631-643`）内で
  `'s11:' || batchId || ':' || sha256hex(conceptId)` として materialize。`batchId` は commit ごとランダム UUID。
  `image_mode='none'` の concept は illustration 行を作らず `illustration_key=NULL`。R1/W1 は concept 単位で同一 key を共有。
- **commit は非同期**: RPC は 202 `{batchId,status:'queued'}` を返し、カードは worker が後作成。ただし illustration 行
  （＝ key の実体）は commit RPC 内で同期作成される → card_mnemonics も同一 RPC トランザクションで同期 upsert 可能。
- **preview-token**（`frontend/src/lib/ai-import/preview-token.ts`）: `{v,userId,reservationKey,importRequestHash,expiresAt}`
  を HMAC-SHA256 署名。shape guard は厳密 5 キー。`importRequestHash`（`canonical-request.ts`）は
  deck + items（clientItemId/conceptId/pattern/front/back/tags/image）を被覆するが **mnemonic 内容は非被覆**。
- **commit 経路**: route `frontend/app/api/ai/imports/commit/route.ts` → service `frontend/src/lib/ai-import/service.ts`
  （`commitCardImport` / `parseCommitInput`）→ repository `frontend/src/lib/ai-import/app-ai-repository.ts`
  （service-role client で `rpc("commit_generated_import_async", ...)`）。
- **card_mnemonics**（`supabase/migrations/20260721000001_s16_card_mnemonics.sql`）: `(owner_user_id, illustration_key)`
  UNIQUE、`illustration_key text NOT NULL`、owner-scoped RLS（select/insert/update）、`status IN ('draft','approved')`。
  Database 型は `frontend/src/types/database.ts:551`、RPC 型は同 `:975`。
- **サニタイズ**: `frontend/src/lib/ai-import/normalize.ts`（`normalizeDisplayText` = NFKC + 空白畳み + trim、
  `isUnicodeScalarText`）が既存。S-16C 時点で mnemonic テキストは length-cap + moderation のみ（NFKC 未適用）。
- **テスト**: Vitest のみ。Playwright / `test:e2e` は未導入。RPC integration は `*.int.test.ts`（`S10_TEST_DATABASE_URL` 必須）。

## 受入条件（測定可能）

- **AC-1**: 生成後、各 concept の slots（`kanji` / `isSingleKanji`（自動判定＋手動トグル）/ `shapeHint.part` /
  `shapeHint.picture` / `meaningHint` / `story`）と explanation（`summary` / `mappings[]`）が `mnemonicDraft` を初期値に
  編集フォームへ表示され、編集後に承認して commit できる（client test）。
- **AC-2**: commit 成功後、illustration_key を持つ承認済み concept について `card_mnemonics` に
  `owner_user_id=認証ユーザー`・`status='approved'`・`illustration_key` = RPC 採番値・`slots`/`explanation` = 承認内容
  の行が存在する（`*.int.test.ts` で DB 検証）。
- **AC-3**: `explanation.mappings` は 2 件未満 / 4 件超を **client と server 双方**で保存前に拒否する
  （client はボタン活性/バリデーション、server は `VALIDATION_ERROR` で拒否）。追加・削除操作ができる。
- **AC-4**: 未承認（該当 concept を承認していない）commit では当該 concept の `card_mnemonics` に 0 行。かつ、
  `image='ai'` かつ未承認の concept について UI に「ニーモニック未承認：画像は生成されません」を明示する。
- **AC-5**: 他 owner の `card_mnemonics` を read/write できない（RLS が最終防衛線、owner は認証セッション由来で
  client 指定不可）（`*.int.test.ts` で別 actor の select/insert 拒否）。
- **AC-6**: `npm --prefix frontend run check` 通過（route / Server-Client 境界変更のため `build` も実行）。

## 非機能・制約（セキュリティ三層 + 境界）

- **認証**: commit route で `auth.getUser()` により認証必須（既存踏襲）。owner は必ず認証セッション由来。
- **所有権**: mnemonic の owner は client 指定を受け付けず `p_actor_user_id`（＝認証ユーザー）で固定。
  commit body の mnemonic の `conceptId` は署名済み request（`importRequestHash` 被覆）内の item にのみ紐づく。
- **RLS**: `card_mnemonics` の owner-scoped RLS を最終防衛線とする（S-16F の直接 read 等）。
- **preview-token 不破壊**: token の 5 キー shape と `importRequestHash` 被覆範囲を変更しない。mnemonic は token に
  相乗りさせず、commit body の別フィールドで搬送し、server 側で独立に再検証・再サニタイズする。
- **Server/Client 境界**: server-only secret（HMAC / service role）を client bundle へ露出しない。
- **サニタイズ**: 保存前に mnemonic の全テキストへ `normalizeDisplayText`（NFKC）を適用し、S-16C 由来の length-cap
  （story 等 1–100、summary 1–120、mappings part/meaning 1–100、kanji 1–16）と mappings 2–4 を server で強制する。
- **DB 一体変更**: migration / RLS（既存）/ Database 型 / seed（該当時）/ テストを一体で扱う。
- **冪等性**: 同一 idempotencyKey 再 commit・worker 再試行で二重化しないよう `ON CONFLICT (owner_user_id, illustration_key) DO UPDATE`。
- **Feature flag**: 既存 `isAiCardImportEnabled` を流用（新フラグを追加しない）。

## スコープ外

- 画像生成トリガー（S-16E）・答え側の説明表示（S-16F）。
- Remote MCP 経由の承認（本 Story は app_ai / cookie 認証経路のみ）。
- preview-token / `importRequestHash` の契約変更。
