---
id: ADR-004
feature: illustration-generation-backend
type: adr
version: 1.0.0
created: 2026-02-24
status: Accepted
based_on: specs/stories/S-08-illustration-generation-backend/requirements.md
related_epic: specs/epics/E-03-illustration-generation/epic.md
---

# ADR-004: S-08のイラスト生成バックエンドMVP境界を固定

## ステータス

Accepted

## コンテキスト

S-08（illustration-generation-backend）は、Gemini画像生成・Supabase Storage・`illustrations` 状態管理を統合しつつ、学習フローを止めない非同期実行をMVPで提供する必要がある。

一方で、既存仕様には解釈ぶれの余地がある。

- ADR-002/S-02では `illustrations` をDB行/Storageとも owner scoped private としてAccepted済み
- E-03 epic と S-08 story の旧記述には `public/` パスや `after()` 前提が残存
- `illustration_key` は非ユニーク運用が既定であり、`getIllustrationUrl` の取得規則を決めないと実装差分が発生

S-08では、以下4論点をDesign Docより前に固定する。

1. owner scoped private 境界維持（ADR-002/S-02整合）
2. Next.js 14.2.5 MVP非同期方式（fire-and-forget）
3. Gemini連携方式（fetchベース、SDK追加なし）
4. 非ユニーク `illustration_key` の取得決定規則

## 決定事項

1. `illustrations` はDB行/Storageオブジェクトとも owner scoped private を維持する。
   - `owner_user_id` はNULL不可を維持する。
   - Storageパスは `{user_id}/{illustration_id}.png` のみ採用し、MVPで `public/` プレフィックスを使用しない。
2. Next.js 14.2.5 のMVP非同期実行は、Server Action内で `void processIllustrationGeneration(...)` を起動する fire-and-forget を採用する。
   - `triggerIllustrationGeneration` は生成完了待ちをしない。
   - 専用ジョブ基盤（Queue/Worker/Edge Function）や `after()` への移行はFutureとする。
3. Gemini連携は `fetch` ベースのREST呼び出しで実装し、新規SDK依存を追加しない。
   - `GEMINI_API_KEY` 未設定時は外部API呼び出しを行わず `failed` へ遷移する。
4. `illustration_key` 非ユニーク前提の取得規則を固定する。
   - `owner_user_id + illustration_key` で検索する。
   - `status='ready'` かつ `storage_path IS NOT NULL` の候補のみ対象とする。
   - `updated_at DESC` で最新1件を採用する（同時刻衝突時は `id DESC` を補助ソートとして許容）。
   - 該当0件は `null` を返す。

## 根拠

### 検討した選択肢

#### 選択肢1: 共有優先 + 同期実行 + SDK連携 + 一意キー前提
- 説明
  - Storageに `public/` を許容し、`trigger` で生成完了まで待機、Gemini SDK導入、`illustration_key` を実質一意として扱う。
- 利点
  - URL配布モデルに拡張しやすい。
  - SDKで実装初期の記述量を減らせる可能性がある。
- 欠点
  - ADR-002/S-02のowner scoped private境界と衝突する。
  - 同期待機で学習フローをブロックする。
  - 依存追加・バージョン管理負荷が増える。
  - 非ユニーク前提の既存契約と不整合になる。

#### 選択肢2: 境界維持 + `after()` 前提 + SDK連携 + 先着1件取得
- 説明
  - owner private境界は維持するが、非同期は `after()` を前提にし、Gemini SDK導入、`illustration_key` は順序未固定で1件取得する。
- 利点
  - レスポンス非ブロッキングを保てる。
  - 将来の非同期基盤に近い形で記述できる。
- 欠点
  - S-08要件が固定する Next.js 14.2.5 MVP方式（fire-and-forget）とずれる。
  - SDK追加コストが発生する。
  - 取得順序未固定ではテスト再現性と運用説明性が低い。

#### 選択肢3（採用）: 境界維持 + fire-and-forget + fetch連携 + 最新ready1件規則
- 説明
  - ADR-002/S-02境界をそのまま維持し、Server Actionで `void process...` を起動、Geminiは `fetch` で呼び出し、非ユニークキーは最新ready1件規則で解決する。
- 利点
  - S-08 requirements v1.0.1のMust要件と完全整合する。
  - 学習フローをブロックせずMVPを最小差分で実装できる。
  - 依存を増やさず、障害点をHTTP境界に集約できる。
  - 非ユニークキーでも決定的な取得規則を提供できる。
- 欠点
  - 同一キー重複データ自体は許容されるため、運用上は最新採用規則の理解が必要。
  - fire-and-forgetはプロセス停止時に再実行制御が弱く、将来的にQueue移行余地が残る。

### 比較マトリクス

| 評価軸 | 選択肢1 共有+同期+SDK | 選択肢2 境界維持+after+SDK | 選択肢3 境界維持+fire-and-forget+fetch（採用） |
|---|---|---|---|
| ADR-002/S-02整合 | 低 | 高 | 高 |
| S-08 Must要件整合 | 低 | 中 | 高 |
| 学習フロー非ブロッキング | 低 | 高 | 高 |
| 依存追加抑制 | 低 | 低 | 高 |
| 非ユニークkeyの決定性 | 低 | 低 | 高 |
| MVP実装容易性 | 低 | 中 | 高 |

### 決定理由

- owner scoped private境界は、S-02で確定したDB/RLS/Storage policy（`split_part(name, '/', 1) = auth.uid()::text`）と一致させる必要がある。
- MVPは `frontend/package.json` の Next.js `^14.2.5` 前提で、要件が明示する fire-and-forget を採用するのが最小リスクである。
- Gemini連携はRESTエンドポイントが公開されており、`fetch` で必要要件（画像生成・失敗理由記録）を満たせるため、SDK追加はYAGNIと判断する。
- `illustration_key` 非ユニークを維持しながら実装を一意に決めるには、`owner_user_id` 境界 + `updated_at DESC` 最新採用が最も説明可能である。

## 影響

### ポジティブな影響

- S-08の4論点に対して実装解釈を1つに固定できる。
- DB行とStorageオブジェクトの境界不整合（403/漏洩リスク）を予防できる。
- `triggerIllustrationGeneration` の応答性能を生成時間から分離できる。
- `getIllustrationUrl` のテスト期待値を決定的に定義できる。

### ネガティブな影響

- fire-and-forget方式は専用キューと比較して再実行制御・監視拡張が限定的である。
- 非ユニーク運用を維持するため、運用時に重複レコードが残る可能性がある。

### 中立的な影響

- Queue/Worker/`after()` など高度な非同期基盤はFutureで再評価する。
- 公開配布（`public/` パス）モデルは別ストーリー/別ADRで判断する。

## 実装への指針

- Server Action `triggerIllustrationGeneration(cardId)`
  - 未認証時は即時エラーで終了し、DB副作用0件・外部API呼び出し0回を保証する。
  - `ready`/`pending` は no-op、`failed` は `pending` に戻して再生成、レコードなしは `pending` INSERT。
  - 生成起動は `void processIllustrationGeneration(...)` とし、レスポンスで完了待ちしない。
- 生成処理 `processIllustrationGeneration(...)`
  - `GEMINI_API_KEY` を含む環境変数の取得は `frontend/src/lib/env.ts` を経由し、直接 `process.env` を参照しない。
  - `sanitizePromptInput` を通したプロンプトでGemini RESTを `fetch` 呼び出しする。
  - 成功時はStorageアップロード後に `ready`、失敗時は `failed` とし、`model_info` に理由を保存する。
- Storage
  - バケット `illustrations` はprivate前提。
  - オブジェクト名は常に `{user_id}/{illustration_id}.png`。
- 取得処理 `getIllustrationUrl(illustrationKey)`
  - 条件: `owner_user_id = auth.uid()` AND `illustration_key = $1` AND `status='ready'` AND `storage_path IS NOT NULL`
  - 並び: `updated_at DESC, id DESC`
  - 取得: `LIMIT 1`、該当なしは `null`
  - Signed URL有効期限: 3600秒

## 受入条件（EARS）

- 遍在型: システムは `illustrations` のDB行とStorageオブジェクトをowner scoped privateとして扱うこと。
- 遍在型: システムはStorageパスとして `{user_id}/{illustration_id}.png` 形式のみを使用すること。
- 契機型: `triggerIllustrationGeneration(cardId)` が呼び出されたとき、システムはServer Action内で `void processIllustrationGeneration(...)` を起動し、生成完了待ちを行わず応答を返すこと。判定指標は「5秒遅延挿入時の応答p95」とし、期待値は「p95 <= 300ms」であること。
- 選択型: もし `triggerIllustrationGeneration(cardId)` が未認証で呼び出されたなら、システムは認証エラーを返し、`illustrations` へのDML件数0件かつ外部API呼び出し0回で終了すること。
- 選択型: もし `GEMINI_API_KEY` が未設定なら、システムはGemini APIを呼び出さず `status='failed'` と `model_info` 理由記録を行うこと。
- 条件型: もし `getIllustrationUrl(illustrationKey)` が呼び出されたなら、システムは `owner_user_id + illustration_key` 条件で `ready` かつ `storage_path` 非NULLの候補を `updated_at DESC, id DESC` で並べ、最新1件のみを採用してSigned URLを返すこと。
- 不測型: もし上記条件に一致する行が存在しないなら、システムは `null` を返すこと。

## 参考資料

- `specs/stories/S-08-illustration-generation-backend/requirements.md`
- `specs/epics/E-03-illustration-generation/epic.md`
- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- `supabase/migrations/20260223000000_s02_schema_rls.sql`
- `supabase/migrations/20260223000001_s02_storage_illustrations.sql`
- Next.js Docs, `serverActions` config（Server ActionsはNext.js 14でstable）: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
- Next.js Docs, `after` function: https://nextjs.org/docs/app/api-reference/functions/after
- Google AI Docs, Gemini image generation（REST例含む）: https://ai.google.dev/gemini-api/docs/image-generation
- Supabase Docs, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Docs, JavaScript `createSignedUrl`: https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
- Supabase Docs, public bucket時の注意（公開URLと操作ポリシーは別）: https://supabase.com/docs/guides/troubleshooting/why-cant-i-uploadlistetc-my-public-bucket-Z6CmGt

## 関連情報

- `specs/adr/ADR-001-project-foundation-supabase-clients.md`
- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- `specs/stories/S-08-illustration-generation-backend/story.md`
