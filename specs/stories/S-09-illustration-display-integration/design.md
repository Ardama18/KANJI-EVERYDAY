---
id: S-09
feature: illustration-display-integration
type: design
version: 1.1.0
created: 2026-02-24
based_on: specs/stories/S-09-illustration-display-integration/requirements.md
---

# Illustration Display Integration Design Document

## 概要

S-09 は、S-07 の学習裏面表示と S-08 のイラスト生成状態管理を接続し、`revealCard` の応答だけで裏面のイラスト表示分岐を完結させる。  
本設計では `illustrationStatus` を `ready | pending | generating | failed | none` に正規化し、UI は `CardBack` と新規 `IllustrationDisplay` に責務分離して非阻害表示を実現する。

## 背景とコンテキスト

### 仕様優先順位

- 最優先: `specs/stories/S-09-illustration-display-integration/requirements.md`（v1.0.1）
- 準拠: `specs/adr/ADR-006-illustration-display-state-contract.md`
- 参照: `specs/stories/S-09-illustration-display-integration/story.md`
- 参照: `specs/stories/S-08-illustration-generation-backend/design.md`

### 前提となる ADR

- `specs/adr/ADR-006-illustration-display-state-contract.md`
  - `revealCard` を5状態契約で返す
  - 状態正規化を Server Action に集中する
- `specs/adr/ADR-004-illustration-generation-backend-mvp-decisions.md`
  - イラスト生成は S-08 既存契約（`triggerIllustrationGeneration`）を利用する
- `specs/adr/ADR-005-study-session-flow.md`
  - 学習フローの front/back/rating 境界を維持する

### 合意事項チェックリスト

#### スコープ

- [x] `revealCard` に `illustrationStatus` 判定と `illustrationUrl` 返却を実装する
- [x] `ready && storage_path` のみ URL を返し、`ready && storage_path` 欠落は `pending` へ正規化する
- [x] `ok/started` 分岐（`triggerIllustrationGeneration` 戻り値）を `revealCard` に反映する
- [x] `CardBack` から表示分岐を分離し、新規 `IllustrationDisplay` を導入する
- [x] `frontend/next.config.mjs` に `images.remotePatterns` を定義する
- [x] `getStudySessionState(phase=back)` でも `revealCard` と同一正規化ロジックを使い、必要時 `triggerIllustrationGeneration` を許容する

#### 非スコープ

- [x] `failed` 状態の再試行 UI / 自動再試行（S-09対象外）
- [x] 生成モデル・プロンプト・Storage 仕様の再設計（S-08 の責務）
- [x] 裏面表示後のポーリング/SSE などリアルタイム更新

#### 制約

- [x] 表面（front）ではイラストを表示しない
- [x] `<Image>` は `priority` 未使用、`width`/`height`/`sizes` を明記する
- [x] 画像設定は `frontend/next.config.mjs` を単一ソースとする

## 解決する問題

- 現状 `revealCard` は `illustrationUrl: null` 固定で、S-08 の状態情報を UI へ連携できない。
- `illustrations` の `ready/pending/failed` と「レコードなし時のトリガー結果」を UI 側で推測すると、分岐漏れや重複実装が起きる。
- `ready` だが `storage_path` が欠落した異常行を未定義のまま扱うと、表示契約が破綻する。

## 要件

### 機能要件

- `CardBackData` に `illustrationStatus` を追加し、`revealCard` と `getStudySessionState(phase=back)` の双方で返却する。
- `revealCard` と `getStudySessionState(phase=back)` は共通 `normalizeIllustrationState` を利用し、`illustration_key` / `illustrations` / `triggerIllustrationGeneration` の結果を5状態へ正規化する。
- `getStudySessionState(phase=back)` は `illustrations` レコード欠落時に `triggerIllustrationGeneration` を許容し、`revealCard` と同じ回復動線を維持する。
- `ready` は `storage_path` があり Signed URL 生成成功時のみ返す。
- `ready && storage_path 欠落` は `pending` へ正規化し、URL は返さない。
- `IllustrationDisplay` は状態ごとの描画責務を持ち、`none` は `null` を返す。

### 非機能要件

- **信頼性**: `triggerIllustrationGeneration` が `ok=false` または例外でも `revealCard` 自体は失敗させず `pending` で継続。
- **性能**: `revealCard` の追加処理は軽量クエリ + URL生成のみとし、画像バイト転送を行わない。
- **保守性**: 状態判定は Server Action 側に集約し、UI は pure mapping のみ。

## 受入条件（EARS）

- 遍在型: システムは `illustrationStatus` を `ready|pending|generating|failed|none` のみで返すこと。
- 選択型: もし `illustration_key` が `null` なら、システムは `none` と `illustrationUrl=null` を返すこと。
- 選択型: もし `illustrations.status='ready'` かつ `storage_path` が存在するなら、システムは `ready` と Signed URL を返すこと。
- 不測型: もし `illustrations.status='ready'` だが `storage_path` が欠落している場合、システムは `pending` へ正規化すること。
- 契機型: `illustrations` レコードがなく `triggerIllustrationGeneration` が `ok=true && started=true` のとき、システムは `generating` を返すこと。
- 選択型: もし `triggerIllustrationGeneration` が `ok=true && started=false` のとき、システムは `pending` を返すこと。
- 不測型: もし `triggerIllustrationGeneration` が `ok=false` または例外のとき、システムは `pending` を返すこと。
- 状態型: `illustrationStatus='none'` の間、システムはイラスト領域 DOM を描画しないこと。
- 状態型: `illustrationStatus='ready'` の間、システムは `<Image>` で表示し、ロード失敗時はプレースホルダへフォールバックすること。
- 遍在型: システムは表面でイラストを表示しないこと。

## 既存コードベース分析

### 調査サマリ

- `frontend/src/actions/session-actions.ts`
  - `revealCard` は現状 `illustrationUrl: null` 固定。
  - `getStudySessionState(phase=back)` も同じ `toCardBackData` を利用するため、ここも更新対象。
- `frontend/src/actions/illustration-actions.ts`
  - `triggerIllustrationGeneration` は `ok/started` 契約をすでに提供。
  - `getSignedUrl` は `frontend/src/lib/illustration/storage.ts` に実装済み（デフォルト3600秒）。
- `frontend/src/components/study/CardBack.tsx`
  - 現在は固定プレースホルダを直接描画しており、状態分岐を持たない。
- `frontend/next.config.mjs`
  - 未作成。S-09 で新規作成が必要。

### 実装パスマッピング

| 種別 | パス | 役割 |
|---|---|---|
| 既存（更新） | `frontend/src/actions/session-actions.ts` | `CardBackData` 契約拡張、`revealCard` 状態正規化、`getStudySessionState` 裏面復元更新 |
| 既存（更新） | `frontend/src/actions/session-actions.test.ts` | `revealCard` の状態分岐と異常系フォールバック検証を追加 |
| 既存（更新） | `frontend/src/components/study/CardBack.tsx` | 固定プレースホルダを削除し `IllustrationDisplay` 呼び出しのみを担う |
| 既存（更新） | `frontend/src/components/study/CardBack.test.tsx` | `CardBack` が `IllustrationDisplay` 前提構造で描画されることを検証 |
| 既存（更新） | `frontend/src/components/study/RatingButtons.test.tsx` | `onRate` ハンドラが DOM ライブラリなしで呼び出せることを検証し、AC-16 操作継続の根拠を補強 |
| 新規 | `frontend/src/components/study/IllustrationDisplay.tsx` | 状態別描画、`Image` エラーフォールバック、`data-testid` 提供 |
| 新規 | `frontend/src/components/study/IllustrationDisplay.test.tsx` | `ready/pending/generating/failed/none` + AC-16（ロード失敗フォールバック）の unit テスト |
| 新規 | `frontend/next.config.mjs` | `images.remotePatterns`（`*.supabase.co/storage/v1/object/sign/**`） |
| 既存（更新） | `frontend/vitest.config.ts` | `specs/stories/S-09-illustration-display-integration/tests/*.test.ts` を include |
| 新規（統合） | `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts` | reveal->back 表示統合の AC 検証 |
| 新規（E2E骨格） | `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts` | 学習フロー上の裏面表示シナリオ骨格 |

### 統合点

- **統合点1**: `session-actions.ts::revealCard` と `illustration-actions.ts::triggerIllustrationGeneration`
- **統合点2**: `CardBack` と `IllustrationDisplay` の責務分離
- **統合点3**: Next.js Image 最適化と Supabase Signed URL 設定（`next.config.mjs`）
- **統合点4**: `getStudySessionState(phase=back)` の復元時に `revealCard` と同一正規化ロジックを再利用し、必要時 trigger を許容

## 設計

### 実装アプローチ

**選択アプローチ: ハイブリッド（Server Action 正規化 + UI分割）**

- サーバー側で状態の意味論を確定する（推論ロジックをUIへ渡さない）。
- UI は `status -> view` マッピングのみを持つ。
- 既存 S-07 学習フローの front/back/rate 進行は維持し、裏面描画部のみ差し替える。

### アーキテクチャ境界（Server Action / UI / Storage）

```mermaid
flowchart LR
  subgraph UI["UI Layer (Client Components)"]
    SC[StudyClient]
    CB[CardBack]
    ID[IllustrationDisplay]
    RB[RatingButtons]
  end

  subgraph SA["Server Action Layer"]
    RC[revealCard(sessionId)]
    GS[getStudySessionState(sessionId)]
    NS[normalizeIllustrationState(shared)]
    TG[triggerIllustrationGeneration(cardId)]
    SU[getSignedUrl(storagePath, 3600)]
  end

  subgraph DB["Supabase DB"]
    CR[cards.illustration_key]
    IL[illustrations.status/storage_path]
  end

  subgraph ST["Supabase Storage"]
    BUCKET[illustrations bucket(private)]
  end

  SC -->|reveal| RC
  SC -->|resume back| GS
  RC --> NS
  GS --> NS
  NS --> CR
  NS --> IL
  NS -->|record missing| TG
  NS -->|ready + path| SU
  TG --> IL
  SU --> BUCKET
  RC -->|CardBackData| CB
  GS -->|CardBackData| CB
  CB --> ID
  CB --> RB
```

### 状態判定フロー（共通 `normalizeIllustrationState`）

- `revealCard` と `getStudySessionState(phase=back)` は、同じ `normalizeIllustrationState({ allowTrigger: true })` を呼び出す。
- `phase=front` では正規化処理を呼ばず、イラスト表示境界を維持する。

```mermaid
flowchart TD
  A[normalizeIllustrationState開始] --> B{illustration_key is null?}
  B -->|yes| N[status=none / url=null]
  B -->|no| C[illustrations 最新行を取得]

  C --> D{行が存在?}
  D -->|yes| E{status}
  E -->|pending| P[status=pending / url=null]
  E -->|failed| F[status=failed / url=null]
  E -->|ready| R{storage_path exists?}
  R -->|yes| S[getSignedUrl(storage_path, 3600)]
  S -->|urlあり| RR[status=ready / url=signed]
  S -->|urlなし| PN1[status=pending / url=null]
  R -->|no| PN2[status=pending / url=null]
  E -->|unknown| PU[status=pending / url=null]

  D -->|no| Z{allowTrigger?}
  Z -->|yes| T[triggerIllustrationGeneration(cardId)]
  Z -->|no| PN0[status=pending / url=null]
  T --> U{result}
  U -->|ok=true && started=true| G[status=generating / url=null]
  U -->|ok=true && started=false| PN3[status=pending / url=null]
  U -->|ok=false| PN4[status=pending / url=null]
  T -->|exception| PN5[status=pending / url=null]
```

### `ok/started` 分岐ルール（確定）

| 条件 | 返却 status | 理由 |
|---|---|---|
| `ok=true && started=true` | `generating` | 今回の `revealCard` で生成開始が確定 |
| `ok=true && started=false` | `pending` | 競合/既存処理中。生成未開始を明示しない安全側 |
| `ok=false` | `pending` | 学習継続優先（異常をUIへ露出しない） |
| 例外発生 | `pending` | 学習継続優先、Server Action全体失敗を回避 |

### `revealCard` / `getStudySessionState(phase=back)` の共通化ポリシー

- 共通ヘルパー `normalizeIllustrationState` を Server Action 層に置き、`revealCard` と `getStudySessionState(phase=back)` の双方で呼び出す。
- 両経路とも `allowTrigger=true` を採用し、`illustrations` レコード欠落時は `triggerIllustrationGeneration` を許容する。
- `triggerIllustrationGeneration` の戻り値評価（`ok/started`）と例外フォールバックは単一実装で処理し、判定乖離を防ぐ。

### `ready && storage_path 欠落` 正規化ルール（共通）

- 異常行（`status='ready'` かつ `storage_path IS NULL`）は **必ず** `pending` へ正規化する。
- Signed URL が作れない `ready` は UI契約上の `ready` とみなさない。
- `getSignedUrl` が `null` を返した場合も同様に `pending` へ正規化する。
- 上記は `revealCard` と `getStudySessionState(phase=back)` の両経路で同一に適用する。

### UIコンポーネント分割

#### `CardBack`

- 学習フロー文脈（進捗、見出し、答えテキスト、評価ボタン）に責務限定。
- イラスト分岐ロジックは持たず、`IllustrationDisplay` を呼び出すだけにする。

#### `IllustrationDisplay`

- `props`: `illustrationStatus`, `illustrationUrl`。
- 描画契約:
  - `none`: `null`
  - `pending | generating`: ローディングプレースホルダ
  - `failed`: 子ども向け静的プレースホルダ（失敗文言なし）
  - `ready`: `<Image>` 表示、`onError` でプレースホルダへ切替
- テスト観測用 `data-testid`:
  - `illustration-region`, `illustration-image`, `illustration-loading`, `illustration-failed`, `illustration-fallback`

### 型契約

```ts
export type IllustrationDisplayStatus =
  | "ready"
  | "pending"
  | "generating"
  | "failed"
  | "none"

export interface CardBackData {
  cardId: string
  skill: "reading" | "writing"
  pattern: "R1" | "W1"
  frontText: string
  backText: string
  illustrationUrl: string | null
  illustrationStatus: IllustrationDisplayStatus
  intervalPreview: IntervalPreview
}
```

### `frontend/next.config.mjs` 設計

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/sign/**',
      },
    ],
  },
}

export default nextConfig
```

- 本ストーリーでの設定ファイルは `frontend/next.config.mjs` のみ。
- `next.config.ts` は対象外（存在しても変更しない）。

### 変更影響マップ

```yaml
変更対象: study card back illustration integration (S-09)
直接影響:
  - frontend/src/actions/session-actions.ts
  - frontend/src/actions/session-actions.test.ts
  - frontend/src/components/study/CardBack.tsx
  - frontend/src/components/study/CardBack.test.tsx
  - frontend/src/components/study/RatingButtons.test.tsx
  - frontend/src/components/study/IllustrationDisplay.tsx
  - frontend/src/components/study/IllustrationDisplay.test.tsx
  - frontend/next.config.mjs
  - frontend/vitest.config.ts
  - specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
  - specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts
間接影響:
  - frontend/src/components/study/StudyClient.tsx（CardBackData型更新追随のみ）
  - getStudySessionState の back 復元表示
  - Next.js build の image host validation
波及なし:
  - SRS 計算ロジック（frontend/src/lib/srs/*）
  - S-08 の生成パイプライン（prompt/generator/storage upload）
  - 表面（front）表示UI
```

### インターフェース変更マトリクス

| 区分 | インターフェース | 変更種別 | 変換必要性 | 互換性確保 |
|---|---|---|---|---|
| 既存 | `CardBackData` | 更新（`illustrationStatus` 追加） | あり | `toCardBackData` の返却を一元更新 |
| 既存 | `revealCard(sessionId)` | 更新（状態判定追加） | なし | 戻り値 shape 維持 + フィールド拡張 |
| 既存 | `getStudySessionState(sessionId)` | 更新（`phase=back` で共通正規化 + 必要時 trigger 許容） | なし | `phase` 契約は維持 |
| 新規 | `IllustrationDisplay(props)` | 追加 | なし | `CardBack` からのみ利用 |
| 新規 | `frontend/next.config.mjs` | 追加 | なし | Next.js標準設定として自動適用 |

### 統合点での E2E 確認手順

1. `illustration_key=null` カードを `revealCard` し、`illustrationStatus='none'` と裏面でのイラスト領域非表示を確認する。  
2. `illustrations.status='ready'` + `storage_path` ありで `revealCard` し、画像表示されることを確認する。  
3. `ready && storage_path=NULL` の異常行で `revealCard` し、`pending` 正規化されることを確認する。  
4. レコードなし + `trigger ok=true started=true` で `generating` 表示になることを確認する。  
5. レコードなし + `trigger ok=true started=false` で `pending` 表示になることを確認する。  
6. `trigger ok=false` または例外でも `revealCard` が成功し `pending` 表示になることを確認する。  
7. `ready` 画像の `onError` を発生させ、`illustration-fallback` 表示と評価ボタン操作継続を確認する。  
8. 表面フェーズではどの状態でもイラスト要素が描画されないことを確認する。

## 実装計画

### 技術的依存関係と実装順序

1. **型・状態判定層（Server Action）**
   - `CardBackData` 拡張、共通 `normalizeIllustrationState` 実装、`revealCard` / `getStudySessionState(phase=back)` 反映
2. **UI層分割**
   - `IllustrationDisplay` 新規作成、`CardBack` 差し替え
3. **Next.js画像設定**
   - `frontend/next.config.mjs` 新規作成
4. **テスト層**
   - unit 更新（actions/components）
   - `specs/stories/S-09.../tests` に integration/e2e 追加
5. **実行確認**
   - `npm --prefix frontend run test`
   - `npm --prefix frontend run typecheck`

### 段階的実装手順（フェーズ）

- Phase 1: `session-actions.ts` に共通状態正規化ヘルパーを導入し、`revealCard` / `getStudySessionState(phase=back)` を更新する（欠落時 trigger 許容を含む）。
- Phase 2: `IllustrationDisplay.tsx` を新規作成し、`CardBack` から固定プレースホルダを除去する。
- Phase 3: `frontend/next.config.mjs` を追加し、`remotePatterns` を設定する。
- Phase 4: 単体テスト（actions/components）を追加・更新する（AC-05 / AC-16 の測定ポイント固定）。
- Phase 5: ストーリー配下 integration/e2e テスト骨格を追加し、ACトレーサビリティを確定する。

## テスト戦略

### 単体テスト（Unit）

- `frontend/src/actions/session-actions.test.ts`
  - `revealCard` の5状態分岐
  - `ok/started` 分岐（`generating` / `pending`）
  - `ready && storage_path欠落 -> pending` 正規化
  - Signed URL 生成が `expiresIn=3600` で呼ばれること（AC-05）
  - `ok=false` / 例外時 `pending` フォールバック
- `frontend/src/components/study/IllustrationDisplay.test.tsx`
  - `none` 非表示、`pending/generating/failed/ready` 表示
  - AC-16: `ready` 画像ロード失敗時の `illustration-fallback` 分岐
- `frontend/src/components/study/CardBack.test.tsx`
  - `IllustrationDisplay` を介した裏面構成（答え + 評価導線、フォールバック時も評価導線維持）
- `frontend/src/components/study/RatingButtons.test.tsx`
  - DOM 追加ライブラリなしで `onRate` ハンドラ実行を確認（AC-16 操作継続の根拠）

### AC-16 検証方法（現行 Vitest 構成）

- 追加ライブラリは導入しない。`frontend/vitest.config.ts` の既存構成（Node + `react-dom/server`）で成立させる。
- `IllustrationDisplay.tsx` に描画分岐の pure function（例: `resolveIllustrationRenderState(status, imageLoadFailed)`）を同居させ、`IllustrationDisplay.test.tsx` で `ready + imageLoadFailed=true -> fallback` を直接検証する。
- `CardBack.test.tsx` で fallback 分岐時にも `RatingButtons` が描画されることを検証し、`RatingButtons.test.tsx` で `onRate` ハンドラ呼び出し成功を確認して「評価ボタン操作継続」を担保する。

### 統合テスト（Integration）

- `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
  - `revealCard` レスポンス契約と `CardBack` 描画契約の接続確認
  - `getStudySessionState(phase=back)` の再表示整合確認

### E2Eテスト（Skeleton）

- `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts`
  - 学習画面で `front -> reveal -> back` の導線確認
  - 状態別表示（ready/pending/failed/none）シナリオの TODO 化

### ACトレーサビリティ（主要）

| AC | Unit | Integration | E2E | 測定ポイント |
|---|---|---|---|---|
| AC-01/02/04/06/07/08/09/10/11 | `session-actions.test.ts` | `illustration-display-integration.int.test.ts` | `illustration-display-integration.e2e.test.ts` | `illustrationStatus` と `illustrationUrl` の契約値 |
| AC-03/12/13/14/15/17 | `IllustrationDisplay.test.tsx`, `CardBack.test.tsx` | `illustration-display-integration.int.test.ts` | `illustration-display-integration.e2e.test.ts` | `data-testid` ごとの DOM 件数 |
| AC-05 | `session-actions.test.ts` | `illustration-display-integration.int.test.ts` | `illustration-display-integration.e2e.test.ts` | Signed URL 生成関数の第2引数が `3600` |
| AC-16 | `IllustrationDisplay.test.tsx`, `CardBack.test.tsx`, `RatingButtons.test.tsx` | `illustration-display-integration.int.test.ts` | `illustration-display-integration.e2e.test.ts` | `illustration-fallback` 表示 + 評価操作継続 |
| AC-18/19 | `next.config.mjs` 静的検査テスト（actions/componentとは別） | `illustration-display-integration.int.test.ts` | `illustration-display-integration.e2e.test.ts` | `remotePatterns` と `<Image>` props 契約 |
| AC-20 | `session-actions.test.ts`（追加API呼び出しなし） | `illustration-display-integration.int.test.ts` | `illustration-display-integration.e2e.test.ts` | 追加API呼び出し 0 回 |

### AC-05 / AC-16 テストケースID明示

| AC | Unit ID | Integration ID | E2E ID |
|---|---|---|---|
| AC-05 | `UT-AC05-SIGNED-URL-EXPIRESIN-3600` | `IT-AC05-SIGNED-URL-EXPIRESIN-3600` | `E2E-AC05-READY-SIGNED-URL` |
| AC-16 | `UT-AC16-READY-LOAD-ERROR-FALLBACK`, `UT-AC16-RATING-HANDLER-ALIVE` | `IT-AC16-FALLBACK-NONBLOCKING` | `E2E-AC16-FALLBACK-NONBLOCKING` |

## リスクと軽減策

| リスク | 影響度 | 発生確率 | 軽減策 |
|---|---|---|---|
| `revealCard` と `getStudySessionState` の判定が乖離する | 高 | 中 | 判定ロジックをヘルパー化して共通利用する |
| `ready` 異常行（`storage_path` 欠落）で UI が不整合になる | 高 | 中 | 設計上 `pending` 正規化を固定しテストで拘束する |
| Image host 未設定で本番時に画像が表示されない | 高 | 中 | `frontend/next.config.mjs` を新規作成し CI で build 検証 |
| 画像ロード失敗で操作不能になる | 中 | 低 | `IllustrationDisplay` で即時フォールバックし評価ボタンは独立維持 |

## 参考資料

- `specs/stories/S-09-illustration-display-integration/requirements.md`
- `specs/adr/ADR-006-illustration-display-state-contract.md`
- `specs/stories/S-08-illustration-generation-backend/design.md`
- `frontend/src/actions/session-actions.ts`
- `frontend/src/actions/illustration-actions.ts`

## 更新履歴

| 日付 | 版 | 変更内容 | 作成者 |
|---|---|---|---|
| 2026-02-24 | 1.1.0 | document-reviewer 指摘反映（AC-05/16トレーサビリティ明示、AC-16のVitest既存構成での検証方法追加、Server Action/UI/Storage境界図追加、`getStudySessionState(phase=back)` の共通正規化+trigger許容明記、`ready && storage_path欠落 -> pending` 共通契約を明確化） | Codex |
| 2026-02-24 | 1.0.0 | 初版作成（S-09状態正規化、UI分割、画像設定、テスト戦略、段階実装） | Codex |
